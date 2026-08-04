import { z } from "zod";
import { TripConstraintSchema } from "@/domain/schema/constraint";
import { CuisineSchema } from "@/domain/schema/cuisine";

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
  // Drives which restaurants are searched for, not just how they rank.
  cuisines: z.array(CuisineSchema).optional(),
  // A closed set: every member changes the schedule. See constraint.ts.
  constraints: z.array(TripConstraintSchema).optional(),
});

export type TripPreferences = z.infer<typeof TripPreferencesSchema>;
