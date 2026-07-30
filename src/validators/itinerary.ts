import type { Itinerary } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import type { ValidationResult } from "@/validators/tripPreferences";

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

// Place.openingHours is a Mon..Sun tuple (index 0-6); JS getUTCDay is Sun=0.
export function weekdayIndex(isoDate: string): number {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export function validateItinerary(
  itinerary: Itinerary,
  places: readonly Place[],
  preferences: TripPreferences,
): ValidationResult {
  const errors: string[] = [];
  const placesById = new Map(places.map((place) => [place.id, place]));

  let previousDate: string | undefined;
  for (const day of itinerary.days) {
    if (day.date < preferences.startDate || day.date > preferences.endDate) {
      errors.push(
        `Day ${day.date} is outside the trip range ${preferences.startDate}..${preferences.endDate}.`,
      );
    }
    if (previousDate !== undefined && day.date <= previousDate) {
      errors.push(
        `Day dates must be unique and strictly ascending (${day.date} follows ${previousDate}).`,
      );
    }
    previousDate = day.date;

    const dayOfWeek = weekdayIndex(day.date);
    let previousActivity: { start: number; end: number } | undefined;
    for (const activity of day.activities) {
      const start = timeToMinutes(activity.start);
      const end = timeToMinutes(activity.end);

      if (start >= end) {
        errors.push(
          `Activity at ${activity.placeId} on ${day.date} must start before it ends (${activity.start}–${activity.end}).`,
        );
      }
      if (previousActivity !== undefined) {
        if (start < previousActivity.start) {
          errors.push(
            `Activities on ${day.date} must be sorted by start time (${activity.start} appears after a later start).`,
          );
        } else if (start < previousActivity.end) {
          errors.push(
            `Activity at ${activity.placeId} on ${day.date} overlaps the previous activity (starts ${activity.start} before it ends).`,
          );
        }
      }
      previousActivity = { start, end };

      const place = placesById.get(activity.placeId);
      if (place === undefined) {
        errors.push(`Unknown placeId "${activity.placeId}" on ${day.date}.`);
        continue;
      }

      const window = place.openingHours[dayOfWeek];
      if (window === null) {
        errors.push(
          `${place.name} is closed on ${WEEKDAY_NAMES[dayOfWeek]} (${day.date}).`,
        );
      } else if (
        start < timeToMinutes(window.open) ||
        end > timeToMinutes(window.close)
      ) {
        errors.push(
          `${place.name} visit ${activity.start}–${activity.end} on ${day.date} falls outside opening hours ${window.open}–${window.close}.`,
        );
      }
    }
  }

  const scheduledNames = new Set<string>();
  for (const day of itinerary.days) {
    for (const activity of day.activities) {
      const place = placesById.get(activity.placeId);
      if (place !== undefined) {
        scheduledNames.add(place.name.trim().toLowerCase());
      }
    }
  }
  const missing = preferences.mustVisit.filter(
    (name) => !scheduledNames.has(name.trim().toLowerCase()),
  );
  if (missing.length > 0) {
    errors.push(`Must-visit places are not scheduled: ${missing.join(", ")}.`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}
