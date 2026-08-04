import { z } from "zod";
import { allDestinations, type Destination } from "@/domain/destination";
import coverageFixture from "../../fixtures/coverage.json";

/**
 * What `pnpm probe` last measured about each destination.
 *
 * Two questions, deliberately separate — conflating them is a mistake this
 * codebase already made once (AGENTS.md §6b):
 *
 * - `serviceable` gates. Without place data there is nothing to schedule.
 * - `transitMeasured` does NOT gate. Google serves no transit in Japan, so
 *   Osaka and Kyoto ship with proxy travel times that the itinerary labels
 *   as estimates. A destination is not withheld for it; the traveller is
 *   told instead.
 *
 * Never hand-edit `fixtures/coverage.json`. The moment it is edited it stops
 * being a measurement and becomes a claim, which is what it exists to
 * replace.
 */
export const CoverageSchema = z.object({
  checkedAt: z.string(),
  destinations: z.record(
    z.string(),
    z.object({ serviceable: z.boolean(), transitMeasured: z.boolean() }),
  ),
});

export type Coverage = z.infer<typeof CoverageSchema>;

const COVERAGE: Coverage = CoverageSchema.parse(coverageFixture);

/** When the shipped coverage record was measured. */
export function coverageCheckedAt(): string {
  return COVERAGE.checkedAt;
}

/**
 * Destinations we can actually plan in. A registered destination that has
 * never been probed is excluded: unmeasured is not the same as working, and
 * offering it would be the guess this whole mechanism removes.
 */
export function serviceableDestinations(): Destination[] {
  return allDestinations().filter(
    (destination) => COVERAGE.destinations[destination.id]?.serviceable === true,
  );
}

/** False when travel times there are proxies rather than real routes. */
export function hasMeasuredTransit(id: string): boolean {
  return COVERAGE.destinations[id]?.transitMeasured === true;
}
