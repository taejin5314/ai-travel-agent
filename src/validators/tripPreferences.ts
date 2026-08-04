import { serviceableDestinations } from "@/domain/coverage";
import type { TripPreferences } from "@/domain/schema/tripPreferences";

export const MAX_TRIP_LENGTH_DAYS = 30;
export const MIN_PARTY_SIZE = 1;
export const MAX_PARTY_SIZE = 20;

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Inclusive day count of a trip; 1 for a same-day trip. */
export function tripLengthInDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

export function validateTripPreferences(
  input: TripPreferences,
): ValidationResult {
  const errors: string[] = [];

  const tripLength = tripLengthInDays(input.startDate, input.endDate);

  if (tripLength < 1) {
    errors.push("endDate must be the same day as or after startDate.");
  } else if (tripLength > MAX_TRIP_LENGTH_DAYS) {
    errors.push(
      `Trip length (${tripLength} days) exceeds the maximum of ${MAX_TRIP_LENGTH_DAYS} days.`,
    );
  }

  // The form only offers serviceable destinations, but a hand-crafted POST
  // must not get a plan for a city we have never probed — it would be built
  // on an empty catalog and fail obscurely later.
  const unavailable = input.destinations.filter(
    (id) => !serviceableDestinations().some((entry) => entry.id === id),
  );
  if (unavailable.length > 0) {
    errors.push(`Unavailable destinations: ${unavailable.join(", ")}.`);
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const place of input.mustVisit) {
    const key = place.trim().toLowerCase();
    if (seen.has(key)) {
      duplicates.add(place.trim());
    }
    seen.add(key);
  }
  if (duplicates.size > 0) {
    errors.push(
      `mustVisit contains duplicate entries: ${Array.from(duplicates).join(", ")}.`,
    );
  }

  if (input.partySize < MIN_PARTY_SIZE || input.partySize > MAX_PARTY_SIZE) {
    errors.push(
      `partySize must be between ${MIN_PARTY_SIZE} and ${MAX_PARTY_SIZE}.`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}
