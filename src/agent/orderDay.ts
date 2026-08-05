import type { Place } from "@/domain/schema/place";

/**
 * The cheapest order to visit a day's stops, subject to the caller's own
 * feasibility rule.
 *
 * The planner picks stops one at a time — must-visit, then same area, then
 * rating — and never reconsiders. That is a greedy walk, not a route, and a
 * live Seoul plan showed what it costs: 55 + 44 + 22 + 25 + 36 minutes of
 * transit in one day, with 경복궁 광화문 and 경복궁 visited either side of a
 * restaurant.
 *
 * Exhaustive is affordable here. A day holds at most four attractions, so
 * there are at most 24 orders, and travel between a fixed pair is already
 * cached. This is not a travelling-salesman approximation problem at our
 * size — it is a small search we can simply finish.
 */

/** Total travel for one candidate order, or undefined if it cannot be walked. */
export type OrderCost = (order: readonly Place[]) => Promise<number | undefined>;

/**
 * Every permutation of `places`, in a deterministic order so that ties break
 * the same way on every run.
 */
function permutations(places: readonly Place[]): Place[][] {
  if (places.length <= 1) {
    return [[...places]];
  }
  const result: Place[][] = [];
  for (let i = 0; i < places.length; i += 1) {
    const rest = [...places.slice(0, i), ...places.slice(i + 1)];
    for (const tail of permutations(rest)) {
      result.push([places[i], ...tail]);
    }
  }
  return result;
}

/**
 * Beyond this many stops the permutation count stops being trivial (7! = 5040
 * travel lookups). The pace cap keeps real days well under it; the guard is
 * here so a future change cannot quietly turn planning into a long search.
 */
const MAX_EXHAUSTIVE = 6;

/**
 * The cheapest feasible order, or the original when nothing is cheaper.
 *
 * `cost` decides both price and feasibility: an order it rejects is not a
 * candidate, however short it looks. Saving travel by breaking opening hours
 * is not an improvement.
 */
export async function bestOrder(
  places: readonly Place[],
  cost: OrderCost,
): Promise<Place[]> {
  const original = [...places];
  if (places.length < 2) {
    return original;
  }
  if (places.length > MAX_EXHAUSTIVE) {
    return original;
  }

  let best = original;
  let bestCost = await cost(original);

  for (const candidate of permutations(places)) {
    // The original is the incumbent; only a strict improvement displaces it,
    // which also keeps the result stable when several orders tie.
    const candidateCost = await cost(candidate);
    if (candidateCost === undefined) {
      continue;
    }
    if (bestCost === undefined || candidateCost < bestCost) {
      best = candidate;
      bestCost = candidateCost;
    }
  }
  return best;
}
