import { describe, expect, it } from "vitest";
import { estimateCost } from "@/domain/cost";
import type { Place, PriceRange } from "@/domain/schema/place";

const open = { open: "11:00", close: "22:00" };

function place(id: string, priceRange?: PriceRange): Place {
  return {
    id,
    name: id,
    area: "osaka",
    category: "restaurant",
    location: { lat: 34.67, lng: 135.5 },
    openingHours: [open, open, open, open, open, open, open],
    typicalVisitMinutes: 60,
    ...(priceRange !== undefined && { priceRange }),
  };
}

const yen = (min?: number, max?: number): PriceRange => ({
  currency: "JPY",
  ...(min !== undefined && { min }),
  ...(max !== undefined && { max }),
});

describe("estimateCost", () => {
  it("sums both bounds and scales by party size", () => {
    const estimate = estimateCost(
      [place("a", yen(1000, 2000)), place("b", yen(1500, 3000))],
      2,
    );
    expect(estimate).toEqual({
      currency: "JPY",
      min: 5000,
      max: 10000,
      pricedStops: 2,
      unpricedStops: 0,
    });
  });

  it("drops the ceiling when any stop is open-ended", () => {
    // "From ¥10,000" has no upper bound, so neither does the day. Falling
    // back to the lower bound would quietly understate the meal.
    const estimate = estimateCost(
      [place("ramen", yen(1000, 2000)), place("kaiseki", yen(10000))],
      1,
    );
    expect(estimate?.min).toBe(11000);
    expect(estimate?.max).toBeUndefined();
  });

  it("reports how many stops it could not price", () => {
    const estimate = estimateCost(
      [place("priced", yen(1000, 2000)), place("unknown"), place("also-unknown")],
      1,
    );
    expect(estimate?.pricedStops).toBe(1);
    expect(estimate?.unpricedStops).toBe(2);
  });

  it("reports no figure — not zero — when nothing has a price", () => {
    // ¥0 reads as free, which is a different claim from "we do not know".
    // The COUNT still comes back, so those stops stay visible in the trip
    // total's "excluded" line instead of vanishing from it.
    const estimate = estimateCost([place("a"), place("b")], 2);
    expect(estimate).toEqual({ pricedStops: 0, unpricedStops: 2 });
    expect(estimate?.min).toBeUndefined();
    expect(estimate?.max).toBeUndefined();
    expect(estimate?.currency).toBeUndefined();
  });

  it("returns nothing at all for an empty set", () => {
    expect(estimateCost([], 2)).toBeUndefined();
  });

  it("refuses to add different currencies", () => {
    // No conversion rates here, so a sum would be a meaningless number.
    const estimate = estimateCost(
      [place("jp", yen(1000, 2000)), place("kr", { currency: "KRW", min: 9000 })],
      1,
    );
    expect(estimate?.min).toBeUndefined();
    expect(estimate?.max).toBeUndefined();
    expect(estimate?.unpricedStops).toBe(2);
  });

  it("scales a single traveller and a group differently", () => {
    const one = estimateCost([place("a", yen(1000, 2000))], 1);
    const four = estimateCost([place("a", yen(1000, 2000))], 4);
    expect(four?.min).toBe((one?.min ?? 0) * 4);
    expect(four?.max).toBe((one?.max ?? 0) * 4);
  });
});
