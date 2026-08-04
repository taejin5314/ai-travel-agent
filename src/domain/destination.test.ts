import { describe, expect, it } from "vitest";
import {
  allDestinations,
  cuisineOptionsFor,
  cuisineQueryFor,
  destinationAt,
  findDestination,
  registryBounds,
} from "@/domain/destination";

describe("destination registry", () => {
  it("loads and validates the shipped destinations", () => {
    const ids = allDestinations().map((entry) => entry.id);
    expect(ids).toContain("osaka");
    expect(ids).toContain("kyoto");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries a search name that names the country", () => {
    // "Naples" alone would find Florida; the country is what disambiguates.
    for (const destination of allDestinations()) {
      expect(destination.searchName.length).toBeGreaterThan(
        destination.id.length,
      );
      expect(destination.country).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("resolves a coordinate to its destination", () => {
    expect(destinationAt(34.6873, 135.5262)?.id).toBe("osaka");
    expect(destinationAt(34.9671, 135.7727)?.id).toBe("kyoto");
  });

  it("returns nothing for a coordinate outside every destination", () => {
    // Tokyo Tower — a real place, not a registered destination.
    expect(destinationAt(35.6586, 139.7454)).toBeUndefined();
  });

  it("looks a destination up by id", () => {
    expect(findDestination("kyoto")?.name).toBe("교토");
    expect(findDestination("atlantis")).toBeUndefined();
  });

  it("spans every destination in its bounds", () => {
    const bounds = registryBounds();
    for (const destination of allDestinations()) {
      expect(bounds.lat[0]).toBeLessThanOrEqual(destination.bounds.lat[0]);
      expect(bounds.lat[1]).toBeGreaterThanOrEqual(destination.bounds.lat[1]);
      expect(bounds.lng[0]).toBeLessThanOrEqual(destination.bounds.lng[0]);
      expect(bounds.lng[1]).toBeGreaterThanOrEqual(destination.bounds.lng[1]);
    }
  });
});

describe("destination cuisines", () => {
  it("offers the food of the destination, not a global list", () => {
    const paris = cuisineOptionsFor(["paris"]).map((c) => c.id);
    const osaka = cuisineOptionsFor(["osaka"]).map((c) => c.id);

    expect(paris).toContain("bistro");
    // The bug this replaces: a Paris traveller was offered okonomiyaki, and
    // asking for it ran "okonomiyaki restaurants in Paris, France".
    expect(paris).not.toContain("okonomiyaki");
    expect(paris).not.toContain("kaiseki");
    expect(osaka).toContain("okonomiyaki");
    expect(osaka).not.toContain("bistro");
  });

  it("shows a shared cuisine once across several destinations", () => {
    const both = cuisineOptionsFor(["osaka", "kyoto"]).map((c) => c.id);
    expect(both.filter((id) => id === "ramen")).toHaveLength(1);
    // Still the union: Kyoto brings kaiseki, Osaka brings okonomiyaki.
    expect(both).toContain("kaiseki");
    expect(both).toContain("okonomiyaki");
  });

  it("builds the query from the destination that offers it", () => {
    expect(cuisineQueryFor("kyoto", "kaiseki")).toBe(
      "traditional kaiseki restaurants in Kyoto, Japan",
    );
    expect(cuisineQueryFor("paris", "bistro")).toBe(
      "traditional French bistros in Paris, France",
    );
  });

  it("has no query for a cuisine a destination does not offer", () => {
    // This is what stops an Osaka+Kyoto trip searching Osaka for kaiseki.
    expect(cuisineQueryFor("osaka", "kaiseki")).toBeUndefined();
    expect(cuisineQueryFor("paris", "ramen")).toBeUndefined();
  });

  it("offers nothing before a destination is chosen", () => {
    expect(cuisineOptionsFor([])).toEqual([]);
  });
});
