import { matchesName } from "@/domain/placeMatch";
import type { Cuisine } from "@/domain/schema/cuisine";
import { PlaceSchema, type Place } from "@/domain/schema/place";
import type { PlaceArea, PlacesPort } from "@/providers/ports";
import placesFixture from "../../../fixtures/places.json";

/** Name fragments that stand in for a cuisine in the fixture catalog. */
const CUISINE_KEYWORDS: Record<Cuisine, readonly string[]> = {
  ramen: ["ramen", "ichiran", "ippudo", "menbaka", "라멘"],
  sushi: ["sushi", "harukoma", "초밥", "스시"],
  okonomiyaki: ["okonomiyaki", "mizuno", "오코노미야키"],
  "udon-soba": ["soba", "udon", "owariya", "소바", "우동"],
  yakiniku: ["yakiniku", "wagyu", "gyu", "야키니쿠"],
  kaiseki: ["kaiseki", "katsukura", "가이세키"],
  cafe: ["cafe", "coffee", "카페"],
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
    cuisines: readonly Cuisine[],
    area?: PlaceArea,
  ): Promise<Place[]> {
    if (cuisines.length === 0) {
      return [];
    }
    // The fixture has no cuisine field, so the mock matches on the name the
    // way a text search would. Good enough to exercise the planner offline;
    // the real signal comes from the Google provider's cuisine queries.
    const needles = cuisines.flatMap((cuisine) => CUISINE_KEYWORDS[cuisine]);
    return this.places.filter(
      (place) =>
        place.category === "restaurant" &&
        (area === undefined || place.area === area) &&
        needles.some((needle) => matchesName(place, needle)),
    );
  }
}
