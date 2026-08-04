import type { DestinationId } from "@/domain/destination";
import type { Place } from "@/domain/schema/place";
import type { Cuisine } from "@/domain/schema/cuisine";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import type { TransitRide, TravelMode } from "@/domain/schema/travel";

// Kept as a name because it reads well at call sites; it is a destination id.
export type PlaceArea = DestinationId;
// Re-exported, not declared here: an Activity records the mode of the hop that
// reached it, so the union belongs in domain. Providers may depend on domain,
// never the reverse.
export type { TravelMode };

export interface PlacesPort {
  listPlaces(area?: PlaceArea): Promise<Place[]>;
  getPlaceById(id: string): Promise<Place | null>;
  /** Case-insensitive, trimmed substring match against place names. */
  findPlacesByName(query: string): Promise<Place[]>;
  /**
   * Restaurants serving any of the requested cuisines. An empty request
   * returns nothing rather than everything: "no preference" is the planner's
   * business, not the provider's.
   */
  findRestaurants(
    cuisines: readonly Cuisine[],
    area?: PlaceArea,
  ): Promise<Place[]>;
}

/**
 * One hop as a router answered it. The answer carries its own provenance
 * because the question and the answer can disagree: asking for TRANSIT and
 * receiving an all-walking route is a real, observed response, and reporting
 * that as transit would put a fabricated mode in front of the user.
 */
export type TravelEstimate = {
  /** One-way travel time in whole minutes. Zero means there is no journey. */
  minutes: number;
  /** What the traveller actually does, which may differ from the mode asked for. */
  mode: TravelMode;
  /** True when no routing service measured this and a model produced it. */
  estimated: boolean;
  /**
   * The rides a measured transit route is made of. Never set on an estimate:
   * a proxy duration knows nothing about which train you would board.
   */
  lines?: TransitRide[];
};

export interface RoutesPort {
  travelMinutes(
    from: Place,
    to: Place,
    mode: TravelMode,
  ): Promise<TravelEstimate>;
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
