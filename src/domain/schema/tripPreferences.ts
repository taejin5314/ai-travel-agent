import { z } from "zod";
import { TripConstraintSchema } from "@/domain/schema/constraint";

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date string (YYYY-MM-DD)")
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Expected a valid calendar date",
  });

export const TripPreferencesSchema = z.object({
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  lodging: z.object({
    name: z.string().trim().min(1, "lodging.name must not be blank"),
    area: z.string().trim().min(1, "lodging.area must not be blank"),
  }),
  /**
   * Where the trip goes. Required and non-empty: the planner used to fetch
   * every registered destination, which would have mixed Paris into an Osaka
   * trip the moment the registry grew.
   */
  destinations: z.array(z.string().min(1)).min(1),
  partySize: z.number().int().min(1),
  mustVisit: z.array(z.string().min(1)),
  interests: z.array(z.string()),
  pace: z.enum(["relaxed", "balanced", "packed"]),
  /**
   * Cuisine ids offered by the chosen destinations. Not a global enum: what
   * is worth eating depends on where you are, so the list lives in the
   * destination registry and is checked by the validator.
   */
  cuisines: z.array(z.string().min(1)).optional(),
  /**
   * Places the traveller picked on the map. Guaranteed to appear in the
   * plan, like a must-visit, but identified by id rather than by a typed
   * name — the picker knows exactly which place was meant.
   */
  selectedPlaceIds: z.array(z.string().min(1)).optional(),
  // A closed set: every member changes the schedule. See constraint.ts.
  constraints: z.array(TripConstraintSchema).optional(),
});

export type TripPreferences = z.infer<typeof TripPreferencesSchema>;
