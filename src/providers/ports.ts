import type { z } from "zod";
import type { Place, PlaceAreaSchema } from "@/domain/schema/place";

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
