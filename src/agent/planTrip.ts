import { matchesExactly } from "@/domain/placeMatch";
import type { TripConstraint } from "@/domain/schema/constraint";
import type { Activity, DayPlan, Itinerary } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
import type { TravelLeg } from "@/domain/schema/travel";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import type { PlacesPort, RoutesPort } from "@/providers/ports";
import {
  timeToMinutes,
  validateItinerary,
  weekdayIndex,
} from "@/validators/itinerary";
import { validateTripPreferences } from "@/validators/tripPreferences";

export interface PlanTripPorts {
  places: PlacesPort;
  routes: RoutesPort;
}

export type PlanTripResult =
  | { ok: true; itinerary: Itinerary }
  | { ok: false; errors: string[] };

const DAY_START_MINUTES = 9 * 60 + 30;
const DAY_END_MINUTES = 18 * 60 + 30;
const MAX_WALK_MINUTES = 20;
const LATE_START_MINUTES = 11 * 60;
const EARLY_END_MINUTES = 16 * 60 + 30;
const LESS_WALKING_MAX_MINUTES = 8;
// How far a traveller will reasonably go for a meal. Generous enough to reach
// across a metro area (the bay-side aquarium to central Osaka is ~30 minutes)
// but far short of an Osaka-to-Kyoto run; past it the planner prefers no meal
// at all over the expedition.
const MAX_MEAL_TRAVEL_MINUTES = 45;
const LUNCH_START_MINUTES = 12 * 60;
const DINNER_START_MINUTES = 17 * 60 + 30;
const MEAL_HARD_END_MINUTES = 20 * 60;

/**
 * The two meal slots a day is expected to fill, as [start, end) in minutes.
 * Exported so the eval scorer classifies a restaurant stop by the same
 * windows the planner schedules against — otherwise the metric could report a
 * slot filled that the planner never considered filled.
 */
export const MEAL_WINDOWS = {
  lunch: [LUNCH_START_MINUTES, DINNER_START_MINUTES],
  dinner: [DINNER_START_MINUTES, MEAL_HARD_END_MINUTES],
} as const;

export type MealSlot = keyof typeof MEAL_WINDOWS;

/**
 * The scheduling bounds a set of constraints produces. Constraints only ever
 * tighten the default day — none of them can lengthen it — so an unknown or
 * empty list is a no-op rather than an error.
 */
export type ScheduleBounds = {
  dayStart: number;
  dayEnd: number;
  maxWalkMinutes: number;
};

export function scheduleBoundsFor(
  constraints: readonly TripConstraint[] = [],
): ScheduleBounds {
  const has = (constraint: TripConstraint) => constraints.includes(constraint);
  return {
    dayStart: has("late-start") ? LATE_START_MINUTES : DAY_START_MINUTES,
    // Sightseeing only. Someone who wants to stop early still eats dinner,
    // so the meal windows are deliberately left alone.
    dayEnd: has("early-end") ? EARLY_END_MINUTES : DAY_END_MINUTES,
    maxWalkMinutes: has("less-walking")
      ? LESS_WALKING_MAX_MINUTES
      : MAX_WALK_MINUTES,
  };
}

export const PACE_MAX_ACTIVITIES_PER_DAY: Record<
  TripPreferences["pace"],
  number
> = {
  relaxed: 2,
  balanced: 3,
  packed: 4,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${endDate}T00:00:00Z`);
  for (
    let t = Date.parse(`${startDate}T00:00:00Z`);
    t <= end;
    t += MS_PER_DAY
  ) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Korean keywords the /plan form advertises, mapped to catalog categories. */
const INTEREST_KEYWORDS: Record<Place["category"], readonly string[]> = {
  sight: ["sight", "관광", "명소", "랜드마크"],
  food: ["food", "음식", "맛집", "먹거리"],
  shopping: ["shopping", "쇼핑"],
  nature: ["nature", "자연", "공원"],
  culture: ["culture", "문화", "역사", "사찰", "신사"],
  entertainment: ["entertainment", "엔터테인먼트", "놀이공원", "테마파크"],
  // Meal slots and lodging are scheduled structurally, not via interests.
  restaurant: [],
  lodging: [],
};

/**
 * Confidence-weighted rating (Bayesian average). A 4.9 from 30 reviews is
 * weaker evidence than a 4.5 from 60,000, so scores shrink toward the prior
 * until enough reviews accumulate. Without this, real Google data fills every
 * meal slot with tiny tourist-facing restaurants sitting at a nominal 4.9.
 */
const RATING_PRIOR = 4.2;
const RATING_PRIOR_WEIGHT = 300;

export function ratingScore(place: Place): number {
  const rating = place.rating;
  if (rating === undefined) {
    return 0;
  }
  const reviews = place.reviewCount ?? 0;
  return (
    (reviews * rating + RATING_PRIOR_WEIGHT * RATING_PRIOR) /
    (reviews + RATING_PRIOR_WEIGHT)
  );
}

/** Higher confidence-weighted rating first; stable for ties. */
function byRatingDesc(a: Place, b: Place): number {
  return ratingScore(b) - ratingScore(a);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function mapInterestsToCategories(
  interests: readonly string[],
): Set<Place["category"]> {
  const categories = new Set<Place["category"]>();
  for (const interest of interests) {
    const needle = normalize(interest);
    for (const [category, keywords] of Object.entries(INTEREST_KEYWORDS) as [
      Place["category"],
      readonly string[],
    ][]) {
      if (keywords.some((keyword) => normalize(keyword) === needle)) {
        categories.add(category);
      }
    }
  }
  return categories;
}

/**
 * The hop the planner would actually take: walk when it is short enough,
 * otherwise transit. Returns `undefined` when there is no hop to make, so the
 * itinerary never carries a leg the traveller does not travel.
 */
async function travelBetween(
  routes: RoutesPort,
  from: Place,
  to: Place,
  maxWalkMinutes: number,
): Promise<TravelLeg | undefined> {
  // Staying put is not a hop. A revisited restaurant can follow itself when
  // the pool runs dry on a long trip, and both providers floor at 1 minute
  // (mock via Math.max, Google via an explicit same-id shortcut) — without
  // this guard that would surface as a fictitious 1-minute walk.
  if (from.id === to.id) {
    return undefined;
  }
  const walk = await routes.travelMinutes(from, to, "walk");
  if (walk <= maxWalkMinutes) {
    // Providers are external and untrusted (AGENTS.md §7): the port documents
    // a positive integer, but a zero would silently violate TravelLegSchema,
    // so drop it here rather than emit an invalid leg.
    return walk > 0 ? { minutes: walk, mode: "walk" } : undefined;
  }
  const transit = await routes.travelMinutes(from, to, "transit");
  return transit > 0 ? { minutes: transit, mode: "transit" } : undefined;
}

function legMinutes(leg: TravelLeg | undefined): number {
  return leg?.minutes ?? 0;
}

/**
 * Deterministic planner v0. Greedy schedule over the mock catalog:
 * must-visit places first, then interest-matching categories, then the rest.
 * Every decision is plain TypeScript; the result must still pass
 * `validateItinerary` before being returned (AGENTS.md §2/§7).
 */
export async function planTrip(
  preferences: TripPreferences,
  ports: PlanTripPorts,
): Promise<PlanTripResult> {
  const preferencesCheck = validateTripPreferences(preferences);
  if (!preferencesCheck.ok) {
    return { ok: false, errors: preferencesCheck.errors };
  }

  const catalog = await ports.places.listPlaces();

  const mustVisitPlaces: Place[] = [];
  const missingMustVisits: string[] = [];
  for (const rawName of preferences.mustVisit) {
    const matches = await ports.places.findPlacesByName(rawName);
    const exact = matches.find((p) => matchesExactly(p, rawName));
    const resolved = exact ?? matches[0];
    if (resolved === undefined) {
      missingMustVisits.push(rawName.trim());
    } else if (!mustVisitPlaces.some((p) => p.id === resolved.id)) {
      mustVisitPlaces.push(resolved);
    }
  }
  if (missingMustVisits.length > 0) {
    return {
      ok: false,
      errors: [
        `다음 필수 방문지를 장소 목록에서 찾지 못했습니다: ${missingMustVisits.join(", ")}`,
      ],
    };
  }

  const interestCategories = mapInterestsToCategories(preferences.interests);
  const attractions = catalog.filter(
    (p) => p.category !== "restaurant" && p.category !== "lodging",
  );
  const mustVisitIds = new Set(mustVisitPlaces.map((p) => p.id));
  // Restaurants are a separate pool for meal slots; a must-visit restaurant
  // is scheduled as a regular stop instead, never twice.
  const restaurants = catalog
    .filter((p) => p.category === "restaurant" && !mustVisitIds.has(p.id))
    .sort(byRatingDesc);
  const usedRestaurantIds = new Set<string>();

  // Anchor days at the lodging when the entered name matches the catalog.
  // Free text stays supported: an unknown lodging just plans without anchor.
  const lodgingPlace = (
    await ports.places.findPlacesByName(preferences.lodging.name)
  ).find((p) => p.category === "lodging");

  const queuedIds = new Set(mustVisitPlaces.map((p) => p.id));
  const interestPlaces = attractions
    .filter((p) => !queuedIds.has(p.id) && interestCategories.has(p.category))
    .sort(byRatingDesc);
  for (const p of interestPlaces) {
    queuedIds.add(p.id);
  }
  const otherPlaces = attractions
    .filter((p) => !queuedIds.has(p.id))
    .sort(byRatingDesc);

  const queue: Place[] = [...mustVisitPlaces, ...interestPlaces, ...otherPlaces];
  const maxPerDay = PACE_MAX_ACTIVITIES_PER_DAY[preferences.pace];
  const bounds = scheduleBoundsFor(preferences.constraints);

  // Top-rated open restaurant for one meal slot. Nearby beats novel: a
  // restaurant already visited in the current area outranks an unvisited one
  // in the other city, because a repeat of somewhere good beats a two-hour
  // train ride for lunch.
  async function scheduleMeal(
    dayOfWeek: number,
    clock: number,
    previous: Place | undefined,
    slot: MealSlot,
    eatenToday: ReadonlySet<string>,
  ): Promise<{ activity: Activity; place: Place; end: number } | null> {
    const [earliest, latestEnd] = MEAL_WINDOWS[slot];
    // Preference order, worst penalty first: never eat at the same place
    // twice in one day, then stay in the current area, then prefer somewhere
    // new. Each is a fallback, not a filter — a sparse catalog still gets fed.
    // `restaurants` is pre-sorted by rating, which breaks every tie.
    const rank = (r: Place): number =>
      (eatenToday.has(r.id) ? 4 : 0) +
      (previous !== undefined && r.area === previous.area ? 0 : 2) +
      (usedRestaurantIds.has(r.id) ? 1 : 0);
    const pool = restaurants
      .map((restaurant, index) => ({ restaurant, index }))
      .sort((a, b) => rank(a.restaurant) - rank(b.restaurant) || a.index - b.index)
      .map((entry) => entry.restaurant);
    for (const candidate of pool) {
      const window = candidate.openingHours[dayOfWeek];
      if (window === null) {
        continue;
      }
      const travel =
        previous === undefined
          ? undefined
          : await travelBetween(ports.routes, previous, candidate, bounds.maxWalkMinutes);
      // A meal is not worth an expedition. Without this ceiling the planner
      // sent an Osaka trip to Kyoto for lunch once the local pool was used.
      if (legMinutes(travel) > MAX_MEAL_TRAVEL_MINUTES) {
        continue;
      }
      const start = Math.max(
        clock + legMinutes(travel),
        earliest,
        timeToMinutes(window.open),
      );
      const end = start + candidate.typicalVisitMinutes;
      // The slot's own window, not the end of the evening: a lunch that can
      // only start at 18:30 is not lunch, and taking it would leave no room
      // for dinner.
      if (end > Math.min(timeToMinutes(window.close), latestEnd)) {
        continue;
      }
      usedRestaurantIds.add(candidate.id);
      return {
        activity: {
          placeId: candidate.id,
          start: minutesToTime(start),
          end: minutesToTime(end),
          ...(travel !== undefined && { travel }),
        },
        place: candidate,
        end,
      };
    }
    return null;
  }

  const days: DayPlan[] = [];
  for (const date of enumerateDates(preferences.startDate, preferences.endDate)) {
    const dayOfWeek = weekdayIndex(date);
    const activities: Activity[] = [];
    let clock = bounds.dayStart;
    let previous: Place | undefined = lodgingPlace;
    let attractionCount = 0;
    let lunchAttempted = false;
    const eatenToday = new Set<string>();

    while (attractionCount < maxPerDay) {
      // Meal slot: once the morning reaches lunch time, eat before the next
      // stop. Meals do not count toward the pace cap.
      if (!lunchAttempted && clock >= LUNCH_START_MINUTES) {
        lunchAttempted = true;
        const lunch = await scheduleMeal(dayOfWeek, clock, previous, "lunch", eatenToday);
        if (lunch !== null) {
          activities.push(lunch.activity);
          eatenToday.add(lunch.place.id);
          previous = lunch.place;
          clock = lunch.end;
        }
        continue;
      }
      let scheduled = false;
      // Scan order, highest priority first. Two independent signals, ranked
      // must-visit first and area second:
      //  0. unscheduled must-visit in the current area;
      //  1. unscheduled must-visit elsewhere — must-visits outrank every
      //     optional place so area preference can never starve them (with a
      //     large catalog the same-area pool never drains, which would strand
      //     a must-visit in the other city);
      //  2. optional place in the current area — clusters the rest of the day
      //     around whatever anchored it, avoiding Osaka-Kyoto ping-pong;
      //  3. everything else.
      // Ranking area *within* each tier keeps must-visits from ping-ponging
      // between cities just because that is the order they were typed in.
      const scanOrder = queue
        .map((place, index) => {
          const mustVisitRank = mustVisitIds.has(place.id) ? 0 : 2;
          const areaRank =
            previous !== undefined && place.area === previous.area ? 0 : 1;
          return { index, priority: mustVisitRank + areaRank };
        })
        .sort((a, b) => a.priority - b.priority || a.index - b.index)
        .map((entry) => entry.index);
      for (const i of scanOrder) {
        const candidate = queue[i];
        const window = candidate.openingHours[dayOfWeek];
        if (window === null) {
          continue;
        }
        const travel =
          previous === undefined
            ? undefined
            : await travelBetween(ports.routes, previous, candidate, bounds.maxWalkMinutes);
        const start = Math.max(
          clock + legMinutes(travel),
          timeToMinutes(window.open),
        );
        const end = start + candidate.typicalVisitMinutes;
        if (end > Math.min(timeToMinutes(window.close), bounds.dayEnd)) {
          continue;
        }
        activities.push({
          placeId: candidate.id,
          start: minutesToTime(start),
          end: minutesToTime(end),
          ...(travel !== undefined && { travel }),
        });
        queue.splice(i, 1);
        previous = candidate;
        clock = end;
        attractionCount += 1;
        scheduled = true;
        break;
      }
      if (!scheduled) {
        break;
      }
    }

    // Short morning (queue exhausted before noon) still deserves lunch.
    if (!lunchAttempted) {
      const lunch = await scheduleMeal(dayOfWeek, clock, previous, "lunch", eatenToday);
      if (lunch !== null) {
        activities.push(lunch.activity);
        eatenToday.add(lunch.place.id);
        previous = lunch.place;
        clock = lunch.end;
      }
    }
    const dinner = await scheduleMeal(dayOfWeek, clock, previous, "dinner", eatenToday);
    if (dinner !== null) {
      activities.push(dinner.activity);
      eatenToday.add(dinner.place.id);
      previous = dinner.place;
      clock = dinner.end;
    }

    days.push({ date, activities });
  }

  const unscheduledMustVisits = queue.filter((p) =>
    mustVisitPlaces.some((m) => m.id === p.id),
  );
  if (unscheduledMustVisits.length > 0) {
    return {
      ok: false,
      errors: [
        `여행 기간 안에 다음 필수 방문지를 배치하지 못했습니다: ${unscheduledMustVisits
          .map((p) => p.name)
          .join(", ")}`,
      ],
    };
  }

  const itinerary: Itinerary = { days };
  // Coverage must be checked against the RESOLVED place names: the user may
  // have typed a partial or aliased name (e.g. "castle", "오사카성") that
  // findPlacesByName resolved to a catalog entry.
  const check = validateItinerary(itinerary, catalog, {
    ...preferences,
    mustVisit: mustVisitPlaces.map((p) => p.name),
  });
  if (!check.ok) {
    return {
      ok: false,
      errors: ["플래너 내부 오류: 생성된 일정이 검증을 통과하지 못했습니다.", ...check.errors],
    };
  }
  return { ok: true, itinerary };
}
