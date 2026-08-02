import type { Itinerary } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import { timeToMinutes, validateItinerary } from "@/validators/itinerary";

/**
 * Deterministic quality signals for one generated itinerary. Every field is
 * objective and computable from the plan itself — nothing here is a judgement
 * call, so the same input always produces the same numbers and a change in
 * the planner shows up as a diff rather than an opinion.
 */
export type Scorecard = {
  /** Share of requested must-visits that made it into the plan (0..1). Must be 1. */
  mustVisitCoverage: number;
  /** Structural validity: dates, ordering, overlaps, opening hours. */
  validatorPassed: boolean;
  validatorErrors: string[];
  days: number;
  activities: number;
  /** Consecutive stops in different areas. Each one is an Osaka-Kyoto trek. */
  crossAreaHops: number;
  /** Waiting time not explained by the travel leg that follows it. Lower is better. */
  idleMinutes: number;
  mealSlotsFilled: number;
  /** Lunch + dinner per day. */
  mealSlotsExpected: number;
};

/**
 * Mirrors how the planner resolves a typed must-visit name to a catalog entry
 * (`findPlacesByName`): case-insensitive substring over the name and aliases.
 * Coverage has to be forgiving in the same way, or "오사카성" would score as a
 * miss against a place named "Osaka Castle".
 */
function matchesRequest(place: Place, request: string): boolean {
  const needle = request.trim().toLowerCase();
  if (needle.length === 0) {
    return false;
  }
  return (
    place.name.toLowerCase().includes(needle) ||
    (place.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle))
  );
}

export function scoreItinerary(
  itinerary: Itinerary,
  places: readonly Place[],
  preferences: TripPreferences,
): Scorecard {
  const placeById = new Map(places.map((place) => [place.id, place]));
  const scheduled = itinerary.days.flatMap((day) =>
    day.activities.map((activity) => placeById.get(activity.placeId)),
  );

  const covered = preferences.mustVisit.filter((request) =>
    scheduled.some((place) => place !== undefined && matchesRequest(place, request)),
  );
  const mustVisitCoverage =
    preferences.mustVisit.length === 0
      ? 1
      : covered.length / preferences.mustVisit.length;

  // Coverage is measured above, so the validator is asked only about structure
  // here. Passing the raw must-visit strings would double-count the same
  // signal AND fail on aliases the validator matches strictly.
  const validation = validateItinerary(itinerary, places, {
    ...preferences,
    mustVisit: [],
  });

  let crossAreaHops = 0;
  let idleMinutes = 0;
  let mealSlotsFilled = 0;

  for (const day of itinerary.days) {
    let previous: Place | undefined;
    let previousEnd: number | undefined;
    for (const activity of day.activities) {
      const place = placeById.get(activity.placeId);
      if (place?.category === "restaurant") {
        mealSlotsFilled += 1;
      }
      if (previous !== undefined && place !== undefined && place.area !== previous.area) {
        crossAreaHops += 1;
      }
      if (previousEnd !== undefined) {
        const gap =
          timeToMinutes(activity.start) - previousEnd - (activity.travel?.minutes ?? 0);
        idleMinutes += Math.max(0, gap);
      }
      previous = place ?? previous;
      previousEnd = timeToMinutes(activity.end);
    }
  }

  return {
    mustVisitCoverage,
    validatorPassed: validation.ok,
    validatorErrors: validation.ok ? [] : validation.errors,
    days: itinerary.days.length,
    activities: itinerary.days.reduce((n, day) => n + day.activities.length, 0),
    crossAreaHops,
    idleMinutes,
    mealSlotsFilled,
    mealSlotsExpected: itinerary.days.length * 2,
  };
}
