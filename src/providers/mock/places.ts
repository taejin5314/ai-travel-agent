import { PlaceSchema, type Place } from "@/domain/schema/place";
import type { PlaceArea, PlacesPort } from "@/providers/ports";
import placesFixture from "../../../fixtures/places.json";

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
    const needle = query.trim().toLowerCase();
    return this.places.filter((place) => place.name.toLowerCase().includes(needle));
  }
}
