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
};

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
  const queuedIds = new Set(mustVisitPlaces.map((p) => p.id));
  const interestPlaces = catalog.filter(
    (p) => !queuedIds.has(p.id) && interestCategories.has(p.category),
  );
  for (const p of interestPlaces) {
    queuedIds.add(p.id);
  }
  const otherPlaces = catalog.filter((p) => !queuedIds.has(p.id));

  const queue: Place[] = [...mustVisitPlaces, ...interestPlaces, ...otherPlaces];
  const maxPerDay = PACE_MAX_ACTIVITIES_PER_DAY[preferences.pace];

  const days: DayPlan[] = [];
  for (const date of enumerateDates(preferences.startDate, preferences.endDate)) {
    const dayOfWeek = weekdayIndex(date);
    const activities: Activity[] = [];
    let clock = DAY_START_MINUTES;
    let previous: Place | undefined;

    while (activities.length < maxPerDay) {
      let scheduled = false;
      // Cluster days geographically: once a day has a place, prefer
      // candidates in the same area before falling back to the rest, so a
      // single day never ping-pongs between Osaka and Kyoto unnecessarily.
      const scanOrder =
        previous === undefined
          ? queue.map((_, index) => index)
          : [
              ...queue.flatMap((p, index) =>
                p.area === previous?.area ? [index] : [],
              ),
              ...queue.flatMap((p, index) =>
                p.area !== previous?.area ? [index] : [],
              ),
            ];
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
        scheduled = true;
        break;
      }
      if (!scheduled) {
        break;
      }
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
