import type { z } from "zod";
import type { Place, PlaceAreaSchema } from "@/domain/schema/place";
import type { TripPreferences } from "@/domain/schema/tripPreferences";

export type PlaceArea = z.infer<typeof PlaceAreaSchema>;
export type TravelMode = "walk" | "transit";

export interface PlacesPort {
  listPlaces(area?: PlaceArea): Promise<Place[]>;
  getPlaceById(id: string): Promise<Place | null>;
  /** Case-insensitive, trimmed substring match against place names. */
  findPlacesByName(query: string): Promise<Place[]>;
}

export interface RoutesPort {
  /** Estimated one-way travel time in minutes; a positive integer. */
  travelMinutes(from: Place, to: Place, mode: TravelMode): Promise<number>;
}

/**
 * LLM adapter boundary. Anything an LLM returns is UNTRUSTED input: it must
 * be Zod-parsed into domain types and pass `validators/` before use
 * (AGENTS.md §7). The LLM never decides dates, durations, or conflicts.
 */
export interface LlmPort {
  /** Draft an itinerary proposal from candidate places. Returns raw, unvalidated output. */
  draftItinerary(
    preferences: TripPreferences,
    candidatePlaces: Place[],
  ): Promise<unknown>;
}
