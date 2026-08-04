import { matchesName } from "@/domain/placeMatch";
import { PlaceSchema, type Place } from "@/domain/schema/place";
import type { PlaceArea, PlacesPort } from "@/providers/ports";
import placesFixture from "../../../fixtures/places.json";

/**
 * Name fragments standing in for a cuisine in the fixture catalog. Keyed by
 * cuisine id; an id with no entry falls back to matching the id itself, so a
 * destination can add a cuisine without touching the mock.
 */
const CUISINE_KEYWORDS: Record<string, readonly string[]> = {
  ramen: ["ramen", "ichiran", "ippudo", "menbaka"],
  sushi: ["sushi", "harukoma"],
  okonomiyaki: ["okonomiyaki", "mizuno"],
  "udon-soba": ["soba", "udon", "owariya"],
  yakiniku: ["yakiniku", "wagyu", "gyu"],
  kaiseki: ["kaiseki", "katsukura"],
  cafe: ["cafe", "coffee"],
};

export class MockPlacesProvider implements PlacesPort {
  private readonly places: Place[];

  constructor(fixture: unknown = placesFixture) {
    this.places = PlaceSchema.array().parse(fixture);
  }

  async listPlaces(area?: PlaceArea): Promise<Place[]> {
    if (!area) {
      return [...this.places];
    }
    return this.places.filter((place) => place.area === area);
  }

  async getPlaceById(id: string): Promise<Place | null> {
    return this.places.find((place) => place.id === id) ?? null;
  }

  async findPlacesByName(query: string): Promise<Place[]> {
    return this.places.filter((place) => matchesName(place, query));
  }

  async findRestaurants(
    cuisines: readonly string[],
    area?: PlaceArea,
  ): Promise<Place[]> {
    if (cuisines.length === 0) {
      return [];
    }
    // The fixture has no cuisine field, so the mock matches on the name the
    // way a text search would. Good enough to exercise the planner offline;
    // the real signal comes from the Google provider's cuisine queries.
    const needles = cuisines.flatMap(
      (cuisine) => CUISINE_KEYWORDS[cuisine] ?? [cuisine],
    );
    return this.places.filter(
      (place) =>
        place.category === "restaurant" &&
        (area === undefined || place.area === area) &&
        needles.some((needle) => matchesName(place, needle)),
    );
  }
}
