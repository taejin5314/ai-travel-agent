import type { Activity, DayPlan, Itinerary } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
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
const LUNCH_START_MINUTES = 12 * 60;
const DINNER_START_MINUTES = 17 * 60 + 30;
const MEAL_HARD_END_MINUTES = 20 * 60;

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

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function matchesExactly(place: Place, query: string): boolean {
  const needle = normalize(query);
  return (
    normalize(place.name) === needle ||
    (place.aliases ?? []).some((alias) => normalize(alias) === needle)
  );
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

async function travelBetween(
  routes: RoutesPort,
  from: Place,
  to: Place,
): Promise<number> {
  const walk = await routes.travelMinutes(from, to, "walk");
  if (walk <= MAX_WALK_MINUTES) {
    return walk;
  }
  return routes.travelMinutes(from, to, "transit");
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

  // Top-rated open restaurant, preferring the current area and unvisited
  // options; falls back to revisiting one on long trips.
  async function scheduleMeal(
    dayOfWeek: number,
    clock: number,
    previous: Place | undefined,
    earliest: number,
  ): Promise<{ activity: Activity; place: Place; end: number } | null> {
    const unused = restaurants.filter((r) => !usedRestaurantIds.has(r.id));
    const pool = [
      ...unused.filter((r) => previous !== undefined && r.area === previous.area),
      ...unused.filter((r) => previous === undefined || r.area !== previous.area),
      ...restaurants.filter((r) => usedRestaurantIds.has(r.id)),
    ];
    for (const candidate of pool) {
      const window = candidate.openingHours[dayOfWeek];
      if (window === null) {
        continue;
      }
      const travel =
        previous === undefined
          ? 0
          : await travelBetween(ports.routes, previous, candidate);
      const start = Math.max(clock + travel, earliest, timeToMinutes(window.open));
      const end = start + candidate.typicalVisitMinutes;
      if (end > Math.min(timeToMinutes(window.close), MEAL_HARD_END_MINUTES)) {
        continue;
      }
      usedRestaurantIds.add(candidate.id);
      return {
        activity: {
          placeId: candidate.id,
          start: minutesToTime(start),
          end: minutesToTime(end),
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
    let clock = DAY_START_MINUTES;
    let previous: Place | undefined = lodgingPlace;
    let attractionCount = 0;
    let lunchAttempted = false;

    while (attractionCount < maxPerDay) {
      // Meal slot: once the morning reaches lunch time, eat before the next
      // stop. Meals do not count toward the pace cap.
      if (!lunchAttempted && clock >= LUNCH_START_MINUTES) {
        lunchAttempted = true;
        const lunch = await scheduleMeal(
          dayOfWeek,
          clock,
          previous,
          LUNCH_START_MINUTES,
        );
        if (lunch !== null) {
          activities.push(lunch.activity);
          previous = lunch.place;
          clock = lunch.end;
        }
        continue;
      }
      let scheduled = false;
      // Scan order, highest priority first:
      //  0. unscheduled must-visits — they must never be starved by area
      //     preference (with a large catalog the same-area pool never drains,
      //     which would strand a must-visit in the other city);
      //  1. same area as the previous stop — clusters the rest of the day
      //     around whatever anchored it, avoiding Osaka-Kyoto ping-pong;
      //  2. everything else.
      const scanOrder = queue
        .map((place, index) => {
          if (mustVisitIds.has(place.id)) {
            return { index, priority: 0 };
          }
          if (previous !== undefined && place.area === previous.area) {
            return { index, priority: 1 };
          }
          return { index, priority: 2 };
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
            ? 0
            : await travelBetween(ports.routes, previous, candidate);
        const start = Math.max(clock + travel, timeToMinutes(window.open));
        const end = start + candidate.typicalVisitMinutes;
        if (end > Math.min(timeToMinutes(window.close), DAY_END_MINUTES)) {
          continue;
        }
        activities.push({
          placeId: candidate.id,
          start: minutesToTime(start),
          end: minutesToTime(end),
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
      const lunch = await scheduleMeal(
        dayOfWeek,
        clock,
        previous,
        LUNCH_START_MINUTES,
      );
      if (lunch !== null) {
        activities.push(lunch.activity);
        previous = lunch.place;
        clock = lunch.end;
      }
    }
    const dinner = await scheduleMeal(
      dayOfWeek,
      clock,
      previous,
      DINNER_START_MINUTES,
    );
    if (dinner !== null) {
      activities.push(dinner.activity);
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
