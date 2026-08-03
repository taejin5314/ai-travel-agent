import { z } from "zod";

/**
 * What the traveller wants to eat.
 *
 * A closed set, for the same reason constraints are one: every member has to
 * change what the planner does. These drive the catalog SEARCH, not just a
 * filter afterwards — asking for ramen should change which restaurants get
 * fetched, or a rating-sorted pool of okonomiyaki places will simply never
 * contain a ramen shop to prefer.
 */
export const CuisineSchema = z.enum([
  "ramen",
  "sushi",
  "okonomiyaki",
  "udon-soba",
  "yakiniku",
  "kaiseki",
  "cafe",
]);

export type Cuisine = z.infer<typeof CuisineSchema>;
