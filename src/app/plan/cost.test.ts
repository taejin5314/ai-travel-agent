import { describe, expect, it } from "vitest";
import { formatCost, hasFigure, totalCost } from "@/app/plan/cost";

const counts = { pricedStops: 1, unpricedStops: 0 };

describe("formatCost", () => {
  it("renders a closed range", () => {
    expect(formatCost({ currency: "JPY", min: 1000, max: 2000, ...counts })).toContain(
      "~",
    );
  });

  it("renders an open-ended range without inventing a ceiling", () => {
    const text = formatCost({ currency: "JPY", min: 10000, ...counts });
    expect(text.endsWith("~")).toBe(true);
  });

  it("collapses a single-value range", () => {
    const text = formatCost({ currency: "JPY", min: 1000, max: 1000, ...counts });
    expect(text).not.toContain("~");
  });
});

describe("hasFigure", () => {
  it("is false for a count-only estimate", () => {
    expect(hasFigure({ pricedStops: 0, unpricedStops: 3 })).toBe(false);
  });

  it("is true once there is money to show", () => {
    expect(hasFigure({ currency: "JPY", min: 1000, ...counts })).toBe(true);
  });
});

describe("totalCost", () => {
  it("adds day totals without re-scaling by party size", () => {
    const total = totalCost([
      { cost: { currency: "JPY", min: 8000, max: 18000, pricedStops: 2, unpricedStops: 0 } },
      { cost: { currency: "JPY", min: 4000, max: 6000, pricedStops: 1, unpricedStops: 0 } },
    ]);
    expect(total?.min).toBe(12000);
    expect(total?.max).toBe(24000);
  });

  it("keeps unpriced stops from days that had no figure at all", () => {
    // Regression: a day where nothing was priced used to disappear from the
    // total, so the summary claimed nothing had been excluded.
    const total = totalCost([
      { cost: { currency: "JPY", min: 8000, max: 18000, pricedStops: 2, unpricedStops: 0 } },
      { cost: { pricedStops: 0, unpricedStops: 2 } },
    ]);
    expect(total?.min).toBe(8000);
    expect(total?.unpricedStops).toBe(2);
  });

  it("drops the ceiling when one day is open-ended", () => {
    const total = totalCost([
      { cost: { currency: "JPY", min: 8000, max: 18000, pricedStops: 2, unpricedStops: 0 } },
      { cost: { currency: "JPY", min: 22000, pricedStops: 2, unpricedStops: 0 } },
    ]);
    expect(total?.min).toBe(30000);
    expect(total?.max).toBeUndefined();
  });

  it("returns nothing when no day carries a cost", () => {
    expect(totalCost([{}, {}])).toBeUndefined();
  });
});
