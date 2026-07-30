import { describe, expect, it } from "vitest";
import { PlaceSchema } from "@/domain/schema/place";
import { MockPlacesProvider } from "@/providers/mock/places";
import placesFixture from "../../../fixtures/places.json";

describe("fixtures/places.json", () => {
  it("has between 16 and 20 entries", () => {
    expect(placesFixture.length).toBeGreaterThanOrEqual(16);
    expect(placesFixture.length).toBeLessThanOrEqual(20);
  });

  it("has every entry satisfy PlaceSchema", () => {
    for (const entry of placesFixture) {
      const result = PlaceSchema.safeParse(entry);
      expect(result.success, `expected ${JSON.stringify(entry)} to be a valid Place`).toBe(true);
    }
  });
});

describe("MockPlacesProvider", () => {
  it("throws at construction when fixture data is invalid", () => {
    expect(() => new MockPlacesProvider([{ id: "bad" }])).toThrow();
  });

  it("does not throw at construction with the real fixture", () => {
    expect(() => new MockPlacesProvider()).not.toThrow();
  });

  describe("listPlaces", () => {
    it("returns every place when no area is given", async () => {
      const provider = new MockPlacesProvider();
      const places = await provider.listPlaces();
      expect(places.length).toBe(placesFixture.length);
    });

    it("filters by area", async () => {
      const provider = new MockPlacesProvider();
      const osakaPlaces = await provider.listPlaces("osaka");
      expect(osakaPlaces.length).toBeGreaterThan(0);
      expect(osakaPlaces.every((place) => place.area === "osaka")).toBe(true);

      const kyotoPlaces = await provider.listPlaces("kyoto");
      expect(kyotoPlaces.length).toBeGreaterThan(0);
      expect(kyotoPlaces.every((place) => place.area === "kyoto")).toBe(true);
    });
  });

  describe("getPlaceById", () => {
    it("returns the place on a hit", async () => {
      const provider = new MockPlacesProvider();
      const place = await provider.getPlaceById("osaka-castle");
      expect(place?.name).toBe("Osaka Castle");
    });

    it("returns null on a miss", async () => {
      const provider = new MockPlacesProvider();
      const place = await provider.getPlaceById("does-not-exist");
      expect(place).toBeNull();
    });
  });

  describe("findPlacesByName", () => {
    it("matches case-insensitively", async () => {
      const provider = new MockPlacesProvider();
      const matches = await provider.findPlacesByName("osaka castle");
      expect(matches.some((place) => place.id === "osaka-castle")).toBe(true);
    });

    it("matches a trimmed substring with surrounding whitespace", async () => {
      const provider = new MockPlacesProvider();
      const matches = await provider.findPlacesByName("  fushimi  ");
      expect(matches.some((place) => place.id === "fushimi-inari-taisha")).toBe(true);
    });

    it("returns an empty array when nothing matches", async () => {
      const provider = new MockPlacesProvider();
      const matches = await provider.findPlacesByName("nonexistent place xyz");
      expect(matches).toEqual([]);
    });
  });
});
