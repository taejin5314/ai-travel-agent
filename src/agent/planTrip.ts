import { bestOrder } from "@/agent/orderDay";
import { spreadDay } from "@/agent/spreadDay";
import { matchesExactly } from "@/domain/placeMatch";
import type { TripConstraint } from "@/domain/schema/constraint";
import type { Activity, DayPlan, Itinerary } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
import type { TravelLeg } from "@/domain/schema/travel";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import type { PlacesPort, RoutesPort, TravelEstimate } from "@/providers/ports";
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
  | {
      ok: true;
      itinerary: Itinerary;
      /**
       * Every place the itinerary can reference. This is the catalog PLUS
       * anything a cuisine search pulled in, which is why the caller gets it
       * back rather than re-listing: the extra restaurants are not in the
       * catalog, so a second `listPlaces()` would fail to resolve them — and
       * would re-bill the search that found them.
       */
      places: Place[];
    }
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
  if (walk.minutes <= maxWalkMinutes) {
    return toLeg(walk);
  }
  // The router decides what this actually is: a transit query can come back
  // as a walking route, and the leg records the answer, not the question.
  return toLeg(await routes.travelMinutes(from, to, "transit"));
}

function toLeg(estimate: TravelEstimate): TravelLeg | undefined {
  // Providers are external and untrusted (AGENTS.md §7): the port documents a
  // positive integer, but a zero would silently violate TravelLegSchema, so
  // drop it here rather than emit an invalid leg.
  if (estimate.minutes <= 0) {
    return undefined;
  }
  return {
    minutes: estimate.minutes,
    mode: estimate.mode,
    ...(estimate.estimated && { estimated: true as const }),
    ...(estimate.lines !== undefined &&
      estimate.lines.length > 0 && { lines: estimate.lines }),
  };
}

function legMinutes(leg: TravelLeg | undefined): number {
  return leg?.minutes ?? 0;
}

/**
 * The lodging to anchor days at, if any. Prefers the picked id — exact by
 * construction — and only falls back to searching a typed name.
 */
async function resolveLodging(
  places: PlacesPort,
  preferences: TripPreferences,
  allowed: (place: Place) => boolean,
): Promise<Place | undefined> {
  const pickedId = preferences.lodgingPlaceId;
  if (pickedId !== undefined) {
    const picked = await places.getPlaceById(pickedId);
    if (picked !== null && allowed(picked)) {
      return picked;
    }
  }
  const typed = preferences.lodging?.name;
  if (typed === undefined) {
    return undefined;
  }
  return (await places.findPlacesByName(typed)).find(
    (place) => place.category === "lodging" && allowed(place),
  );
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

  // Exactly the chosen destinations — never the whole registry.
  const catalogs = await Promise.all(
    preferences.destinations.map((id) => ports.places.listPlaces(id)),
  );
  const catalog = catalogs.flat();

  const mustVisitPlaces: Place[] = [];
  /**
   * A name search covers every registered destination, so "호텔" on a Seoul
   * trip used to resolve to a hotel in Kyoto — the day then anchored there
   * and every Seoul stop fell out of reach, producing an empty itinerary.
   * Nothing outside the chosen destinations may be resolved.
   */
  const chosen = new Set(preferences.destinations);
  const inChosenDestination = (place: Place) => chosen.has(place.area);

  const missingMustVisits: string[] = [];
  for (const rawName of preferences.mustVisit) {
    const matches = (await ports.places.findPlacesByName(rawName)).filter(
      inChosenDestination,
    );
    const exact = matches.find((p) => matchesExactly(p, rawName));
    const resolved = exact ?? matches[0];
    if (resolved === undefined) {
      missingMustVisits.push(rawName.trim());
    } else if (!mustVisitPlaces.some((p) => p.id === resolved.id)) {
      mustVisitPlaces.push(resolved);
    }
  }
  // Picked on the map: same guarantee as a must-visit, but resolved by id,
  // so there is no name to mis-resolve.
  for (const id of preferences.selectedPlaceIds ?? []) {
    const resolved = await ports.places.getPlaceById(id);
    if (resolved === null || !inChosenDestination(resolved)) {
      missingMustVisits.push(resolved?.name ?? id);
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
  // Requested cuisines widen the pool rather than filter it: a catalog built
  // from generic queries may contain no ramen shop at all, so there would be
  // nothing to prefer. Anything found here joins the pool and outranks the
  // rest within the same area.
  const requestedCuisines = preferences.cuisines ?? [];
  const cuisineMatches =
    requestedCuisines.length > 0
      ? (
          await Promise.all(
            preferences.destinations.map((id) =>
              ports.places.findRestaurants(requestedCuisines, id),
            ),
          )
        ).flat()
      : [];
  const preferredRestaurantIds = new Set(cuisineMatches.map((p) => p.id));
  const restaurantsById = new Map<string, Place>();
  for (const place of [...catalog, ...cuisineMatches]) {
    if (place.category === "restaurant" && !mustVisitIds.has(place.id)) {
      restaurantsById.set(place.id, place);
    }
  }
  const restaurants = [...restaurantsById.values()].sort(byRatingDesc);
  const usedRestaurantIds = new Set<string>();

  // Anchor days at the lodging. A picked id is exact; a typed name is a
  // search and therefore ambiguous, which is how "호텔" on a Seoul trip
  // resolved to a hotel in Kyoto. No lodging at all is fine — days simply
  // start at the first stop.
  const lodgingPlace = await resolveLodging(ports.places, preferences, (place) =>
    inChosenDestination(place),
  );

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
    // twice in one day, then stay in the current area, then serve a cuisine
    // that was asked for, then prefer somewhere new. Each is a fallback, not
    // a filter — an unmatchable request still gets the traveller fed.
    //
    // Area outranks cuisine deliberately: wanting ramen is not a reason to
    // cross the city at lunchtime. Among the restaurants nearby, the ramen
    // shop wins.
    //
    // `restaurants` is pre-sorted by rating, which breaks every tie.
    const rank = (r: Place): number =>
      (eatenToday.has(r.id) ? 8 : 0) +
      (previous !== undefined && r.area === previous.area ? 0 : 4) +
      (preferredRestaurantIds.size > 0 && !preferredRestaurantIds.has(r.id)
        ? 2
        : 0) +
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

  /**
   * Builds one day. Mutates `queue` and `usedRestaurantIds`, so a caller that
   * wants to try several orders must snapshot and restore around each attempt.
   *
   * `forcedOrder` replaces the priority scan with an explicit sequence, which
   * is how an optimised order is replayed through exactly the same scheduling
   * rules that produced the greedy one. Reordering the finished activities
   * instead would have to re-derive every start time, meal slot and travel
   * leg — and would drift from the rules the moment either changed.
   */
  async function planDay(
    date: string,
    forcedOrder?: readonly string[],
  ): Promise<{ activities: Activity[]; chosen: Place[]; travel: number }> {
    const dayOfWeek = weekdayIndex(date);
    const activities: Activity[] = [];
    const chosen: Place[] = [];
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
          if (forcedOrder !== undefined) {
            // Replaying a chosen order: anything outside it goes last, so a
            // day can still fill up if the forced places stop fitting.
            const position = forcedOrder.indexOf(place.id);
            return { index, priority: position < 0 ? forcedOrder.length : position };
          }
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
        chosen.push(candidate);
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

    // Every leg of the finished day, meals included. Counting only the
    // attraction hops optimised a proxy: reordering moves where meals land,
    // and a day that saves ten minutes between museums but adds twenty
    // getting to dinner is not a shorter day.
    const travel = activities.reduce(
      (total, activity) => total + (activity.travel?.minutes ?? 0),
      0,
    );
    return { activities, chosen, travel };
  }

  /**
   * Same stops, later starts where there is room. A relaxed day was finishing
   * its sightseeing before noon and then waiting hours for dinner; the count
   * was right and the placement was not.
   */
  const placeById = new Map(catalog.map((place) => [place.id, place]));
  for (const place of cuisineMatches) {
    placeById.set(place.id, place);
  }
  const spreadFinished = (date: string, activities: Activity[]) =>
    spreadDay(activities, placeById, weekdayIndex(date));

  const days: DayPlan[] = [];
  for (const date of enumerateDates(preferences.startDate, preferences.endDate)) {
    const queueSnapshot = [...queue];
    const usedSnapshot = new Set(usedRestaurantIds);
    const restore = () => {
      queue.length = 0;
      queue.push(...queueSnapshot);
      usedRestaurantIds.clear();
      for (const id of usedSnapshot) {
        usedRestaurantIds.add(id);
      }
    };

    const greedy = await planDay(date);
    if (greedy.chosen.length < 2) {
      days.push({ date, activities: spreadFinished(date, greedy.activities) });
      continue;
    }

    // An order is only a candidate if it still fits every place the greedy
    // pass managed to fit. Saving travel by dropping a stop is not a better
    // route, it is a smaller day.
    const best = await bestOrder(greedy.chosen, async (order) => {
      restore();
      const attempt = await planDay(date, order.map((place) => place.id));
      return attempt.chosen.length === greedy.chosen.length
        ? attempt.travel
        : undefined;
    });
    restore();
    const final = await planDay(date, best.map((place) => place.id));
    days.push({ date, activities: spreadFinished(date, final.activities) });
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
  // The catalog alone is not the universe of scheduled places: cuisine
  // searches add restaurants the catalog never contained.
  const knownPlaces = [...new Map([...catalog, ...cuisineMatches].map((p) => [p.id, p])).values()];
  const check = validateItinerary(itinerary, knownPlaces, {
    ...preferences,
    mustVisit: mustVisitPlaces.map((p) => p.name),
  });
  if (!check.ok) {
    return {
      ok: false,
      errors: ["플래너 내부 오류: 생성된 일정이 검증을 통과하지 못했습니다.", ...check.errors],
    };
  }
  return { ok: true, itinerary, places: knownPlaces };
}
