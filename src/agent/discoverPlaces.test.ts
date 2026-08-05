import { describe, expect, it } from "vitest";
import { discoverPlaces } from "@/agent/discoverPlaces";
import type { Place } from "@/domain/schema/place";
import { MockPlacesProvider } from "@/providers/mock/places";

const open = { open: "09:00", close: "20:00" };

function place(overrides: Partial<Place> & Pick<Place, "id">): Place {
  return {
    name: overrides.id,
    area: "osaka",
    category: "sight",
    location: { lat: 34.67, lng: 135.5 },
    openingHours: [open, open, open, open, open, open, open],
    typicalVisitMinutes: 60,
    ...overrides,
  };
}

const catalog: Place[] = [
  place({ id: "thin-4-9", rating: 4.9, reviewCount: 25 }),
  place({ id: "solid-4-5", rating: 4.5, reviewCount: 60000 }),
  place({ id: "unrated" }),
  place({ id: "kyoto-sight", area: "kyoto", rating: 4.6, reviewCount: 9000 }),
  place({
    id: "famous-brasserie",
    name: "Famous Brasserie",
    category: "restaurant",
    rating: 4.8,
    reviewCount: 90000,
  }),
  place({
    id: "ichiran-ramen",
    name: "Ichiran Ramen",
    category: "restaurant",
    rating: 4.3,
    reviewCount: 20000,
  }),
  place({ id: "hotel", category: "lodging", rating: 4.8, reviewCount: 5000 }),
];

function ports() {
  return new MockPlacesProvider(catalog);
}

describe("discoverPlaces", () => {
  it("ranks by confidence-weighted rating, not raw stars", async () => {
    // The same rule the meal slots use: 4.9 from 25 reviews is weaker
    // evidence than 4.5 from 60,000.
    const found = await discoverPlaces(ports(), ["osaka"]);
    const ids = found.attractions.map((p) => p.id);
    expect(ids.indexOf("solid-4-5")).toBeLessThan(ids.indexOf("thin-4-9"));
    expect(ids.at(-1)).toBe("unrated");
  });

  it("keeps attractions and restaurants apart", async () => {
    const found = await discoverPlaces(ports(), ["osaka"]);
    expect(found.restaurants.map((p) => p.id)).toEqual([
      "famous-brasserie",
      "ichiran-ramen",
    ]);
    expect(found.attractions.map((p) => p.id)).not.toContain("ichiran-ramen");
  });

  it("never offers lodging as somewhere to go", async () => {
    const found = await discoverPlaces(ports(), ["osaka"]);
    const everything = [...found.attractions, ...found.restaurants];
    expect(everything.map((p) => p.id)).not.toContain("hotel");
  });

  it("fetches only the destinations asked for", async () => {
    const found = await discoverPlaces(ports(), ["osaka"]);
    expect(found.attractions.map((p) => p.id)).not.toContain("kyoto-sight");

    const both = await discoverPlaces(ports(), ["osaka", "kyoto"]);
    expect(both.attractions.map((p) => p.id)).toContain("kyoto-sight");
  });

  it("de-duplicates a place that several destinations return", async () => {
    const found = await discoverPlaces(ports(), ["osaka", "osaka"]);
    const ids = found.attractions.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("caps each list so the map is not flooded", async () => {
    const found = await discoverPlaces(ports(), ["osaka", "kyoto"], {
      limit: 2,
    });
    expect(found.attractions).toHaveLength(2);
    expect(found.restaurants.length).toBeLessThanOrEqual(2);
  });

  it("puts requested cuisines above better-rated restaurants that were not asked for", async () => {
    // Live regression: asking Paris for bistros returned a list identical to
    // asking for nothing, because famous brasseries outscored them and the
    // cap cut the bistros off. A request that changes nothing visible is a
    // request that was ignored.
    const withRamen = await discoverPlaces(ports(), ["osaka"], {
      cuisines: ["ramen"],
      limit: 1,
    });
    expect(withRamen.restaurants.map((p) => p.id)).toEqual(["ichiran-ramen"]);
  });

  it("widens the restaurant pool with a cuisine rather than narrowing it", async () => {
    // Filtering would be wrong: a catalog built from generic queries may hold
    // no ramen shop at all, leaving nothing to show.
    const withCuisine = await discoverPlaces(ports(), ["osaka"], {
      cuisines: ["ramen"],
    });
    expect(withCuisine.restaurants.map((p) => p.id)).toContain("ichiran-ramen");

    const without = await discoverPlaces(ports(), ["osaka"]);
    expect(withCuisine.restaurants.length).toBeGreaterThanOrEqual(
      without.restaurants.length,
    );
  });

  it("returns empty lists rather than failing when nothing is asked for", async () => {
    const found = await discoverPlaces(ports(), []);
    expect(found).toEqual({ attractions: [], restaurants: [], lodging: [] });
  });
});
