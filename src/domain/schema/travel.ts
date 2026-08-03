import { z } from "zod";

/**
 * How a traveller covers one hop. Lives in `domain` rather than
 * `providers/ports.ts` because both the RoutesPort and the Itinerary type
 * need it, and `domain` may not import from `providers` (AGENTS.md §2).
 */
export const TravelModeSchema = z.enum(["walk", "transit"]);

/**
 * A single hop between two consecutive stops. `minutes` is a positive integer:
 * a zero-minute leg means "no travel", which is expressed by omitting the leg
 * entirely rather than by storing 0.
 */
export const TravelLegSchema = z.object({
  minutes: z.number().int().positive(),
  mode: TravelModeSchema,
  /**
   * Present only when no routing service measured this leg and the duration
   * came from a straight-line model. Absent means measured.
   *
   * The flag exists because the alternative is lying: when the Routes API has
   * no answer the provider falls back to an estimate, and without this the
   * itinerary showed a 37 km straight-line guess as "🚃 136분" — visually
   * indistinguishable from a real departure board.
   */
  estimated: z.literal(true).optional(),
});

export type TravelMode = z.infer<typeof TravelModeSchema>;
export type TravelLeg = z.infer<typeof TravelLegSchema>;
