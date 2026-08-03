import { MEAL_WINDOWS, type MealSlot } from "@/agent/planTrip";
import { resolvePlace } from "@/domain/placeMatch";
import type { Itinerary } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import { timeToMinutes, validateItinerary } from "@/validators/itinerary";
import { tripLengthInDays } from "@/validators/tripPreferences";

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
  /** Distinct lunch/dinner windows filled, counted once each per day. */
  mealSlotsFilled: number;
  /** Lunch + dinner for every REQUESTED day, so a dropped day lowers the score. */
  mealSlotsExpected: number;
  /** Total minutes on foot across the trip. Lower is better. */
  walkingMinutes: number;
  /** The single longest walk. A trip is judged by its worst hop, not its average. */
  longestWalkMinutes: number;
  /** Legs no routing service measured. Lower is better; it is pure guesswork. */
  estimatedLegs: number;
};

/**
 * Which meal slot a stop starting at this time fills, if any. A restaurant
 * outside both windows — breakfast, or a "lunch" pushed to 18:30 behind a
 * long attraction — fills neither.
 */
function slotAt(startMinutes: number): MealSlot | undefined {
  for (const [slot, [from, to]] of Object.entries(MEAL_WINDOWS) as [
    MealSlot,
    (typeof MEAL_WINDOWS)[MealSlot],
  ][]) {
    if (startMinutes >= from && startMinutes < to) {
      return slot;
    }
  }
  return undefined;
}

export function scoreItinerary(
  itinerary: Itinerary,
  places: readonly Place[],
  preferences: TripPreferences,
): Scorecard {
  const placeById = new Map(places.map((place) => [place.id, place]));
  const scheduledIds = new Set(
    itinerary.days.flatMap((day) => day.activities.map((a) => a.placeId)),
  );

  // Resolve each request to the ONE place the planner would have picked, then
  // ask whether that place is in the plan. Asking "did anything matching the
  // request get scheduled" instead would let Nijo Castle cover a requested
  // Osaka Castle and hide the regression this metric exists to catch.
  const covered = preferences.mustVisit.filter((request) => {
    const resolved = resolvePlace(places, request);
    return resolved !== undefined && scheduledIds.has(resolved.id);
  });
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
  let walkingMinutes = 0;
  let longestWalkMinutes = 0;
  let estimatedLegs = 0;

  for (const day of itinerary.days) {
    let previous: Place | undefined;
    let previousEnd: number | undefined;
    const filledToday = new Set<MealSlot>();
    for (const activity of day.activities) {
      const place = placeById.get(activity.placeId);
      if (place?.category === "restaurant") {
        const slot = slotAt(timeToMinutes(activity.start));
        if (slot !== undefined && !filledToday.has(slot)) {
          filledToday.add(slot);
          mealSlotsFilled += 1;
        }
      }
      if (previous !== undefined && place !== undefined && place.area !== previous.area) {
        crossAreaHops += 1;
      }
      if (activity.travel !== undefined) {
        if (activity.travel.estimated) {
          estimatedLegs += 1;
        }
        if (activity.travel.mode === "walk") {
          walkingMinutes += activity.travel.minutes;
          longestWalkMinutes = Math.max(
            longestWalkMinutes,
            activity.travel.minutes,
          );
        }
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
    // Derived from the request, not the output: a planner that drops a day
    // would otherwise shrink the denominator along with the numerator and
    // report the omission as a perfect score.
    mealSlotsExpected:
      tripLengthInDays(preferences.startDate, preferences.endDate) *
      Object.keys(MEAL_WINDOWS).length,
    walkingMinutes,
    longestWalkMinutes,
    estimatedLegs,
  };
}
