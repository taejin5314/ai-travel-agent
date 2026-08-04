import type { Place, PriceRange } from "@/domain/schema/place";

/**
 * What a set of stops costs, as far as we can honestly say.
 *
 * `pricedStops` and `unpricedStops` are both reported because the number
 * alone is not the answer: a day total of ¥4,000 means something different
 * when it covers two of two restaurants than when it covers two of five.
 * Hiding that would make the estimate look more complete than it is.
 */
export type CostEstimate = {
  /** Absent when nothing in the set had a price at all. */
  currency?: string;
  /** Sum of the lower bounds. Absent when no bound was available. */
  min?: number;
  /** Sum of the upper bounds; absent as soon as ONE stop is open-ended. */
  max?: number;
  pricedStops: number;
  unpricedStops: number;
};

function sameCurrency(ranges: readonly PriceRange[]): string | undefined {
  const currencies = new Set(ranges.map((range) => range.currency));
  // Mixing currencies would need conversion rates we do not have, and adding
  // them regardless would produce a number that means nothing.
  return currencies.size === 1 ? [...currencies][0] : undefined;
}

/**
 * Adds up per-person prices and scales by party size.
 *
 * An open-ended range poisons the upper bound deliberately: if one kaiseki
 * dinner is "from ¥10,000" then no honest ceiling exists for the day, and
 * quietly substituting the lower bound would understate the trip.
 */
export function estimateCost(
  places: readonly Place[],
  partySize: number,
): CostEstimate | undefined {
  if (places.length === 0) {
    return undefined;
  }
  const priced = places.filter(
    (place): place is Place & { priceRange: PriceRange } =>
      place.priceRange !== undefined,
  );
  // Still returned when nothing is priced: the COUNT of what we could not
  // price is itself information, and dropping the whole estimate made those
  // stops vanish from the trip total's "excluded" figure.
  const ranges = priced.map((place) => place.priceRange);
  const currency = sameCurrency(ranges);
  if (priced.length === 0 || currency === undefined) {
    return { pricedStops: 0, unpricedStops: places.length };
  }

  const mins = ranges.map((range) => range.min);
  const maxes = ranges.map((range) => range.max);
  const hasEveryMin = mins.every((min) => min !== undefined);
  const hasEveryMax = maxes.every((max) => max !== undefined);

  const sum = (values: readonly (number | undefined)[]) =>
    values.reduce<number>((total, value) => total + (value ?? 0), 0) * partySize;

  return {
    currency,
    ...(hasEveryMin && { min: sum(mins) }),
    ...(hasEveryMax && { max: sum(maxes) }),
    pricedStops: priced.length,
    unpricedStops: places.length - priced.length,
  };
}
