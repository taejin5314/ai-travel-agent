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
});

export type TravelMode = z.infer<typeof TravelModeSchema>;
export type TravelLeg = z.infer<typeof TravelLegSchema>;
