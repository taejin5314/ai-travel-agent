import { z } from "zod";

/**
 * The constraints the planner can actually honour.
 *
 * Deliberately a closed set rather than free text. The field used to accept
 * any sentence, was shown back in the summary, and changed nothing — the UI
 * promised something the engine did not do. Everything listed here maps to a
 * concrete scheduling rule in `agent/planTrip.ts`, and adding a member means
 * implementing that rule, not just widening the enum.
 *
 * Parsing free-text wishes into this set is a later, separate decision
 * (issue #32, option B): it would make every parse untrusted input and pull
 * the LLM phase forward.
 */
export const TripConstraintSchema = z.enum([
  /** Start the day at 11:00 instead of 09:30. */
  "late-start",
  /** Finish sightseeing by 16:30 instead of 18:30. Meals keep their windows. */
  "early-end",
  /** Take transit for hops a fitter traveller would walk. */
  "less-walking",
]);

export type TripConstraint = z.infer<typeof TripConstraintSchema>;
