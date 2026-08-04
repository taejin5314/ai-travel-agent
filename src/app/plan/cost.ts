import type { CostEstimate } from "@/domain/cost";

/**
 * Formats a cost estimate for display.
 *
 * An open-ended estimate reads "50,000원~" rather than being closed off with
 * a made-up ceiling, and a missing estimate has no string at all — callers
 * render nothing rather than a zero.
 */
/** Whether there is a figure to show at all, as opposed to only counts. */
export function hasFigure(estimate: CostEstimate): boolean {
  return (
    estimate.currency !== undefined &&
    (estimate.min !== undefined || estimate.max !== undefined)
  );
}

export function formatCost(estimate: CostEstimate): string {
  const money = (value: number) =>
    new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: estimate.currency ?? "JPY",
      maximumFractionDigits: 0,
    }).format(value);

  if (estimate.min !== undefined && estimate.max !== undefined) {
    return estimate.min === estimate.max
      ? money(estimate.min)
      : `${money(estimate.min)}~${money(estimate.max)}`;
  }
  if (estimate.min !== undefined) {
    return `${money(estimate.min)}~`;
  }
  return `~${money(estimate.max ?? 0)}`;
}

/**
 * Sums day estimates into one trip figure. Kept separate from the domain
 * estimator because it adds already-scaled day totals rather than per-person
 * prices — passing a party size again here would multiply it twice.
 */
export function totalCost(
  days: readonly { cost?: CostEstimate }[],
): CostEstimate | undefined {
  const costs = days.flatMap((day) => (day.cost === undefined ? [] : [day.cost]));
  if (costs.length === 0) {
    return undefined;
  }
  // Days with no priced stop still contribute their unpriced count; they
  // simply have no currency to reconcile.
  const withFigures = costs.filter(hasFigure);
  const currencies = new Set(withFigures.map((cost) => cost.currency));
  if (currencies.size > 1) {
    return undefined;
  }
  const hasEveryMin = withFigures.every((cost) => cost.min !== undefined);
  const hasEveryMax = withFigures.every((cost) => cost.max !== undefined);
  return {
    ...(withFigures.length > 0 && { currency: withFigures[0].currency }),
    ...(withFigures.length > 0 &&
      hasEveryMin && {
        min: withFigures.reduce((sum, cost) => sum + (cost.min ?? 0), 0),
      }),
    ...(withFigures.length > 0 &&
      hasEveryMax && {
        max: withFigures.reduce((sum, cost) => sum + (cost.max ?? 0), 0),
      }),
    pricedStops: costs.reduce((sum, cost) => sum + cost.pricedStops, 0),
    unpricedStops: costs.reduce((sum, cost) => sum + cost.unpricedStops, 0),
  };
}
