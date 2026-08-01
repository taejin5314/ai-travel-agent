import { z } from "zod";
import { TimeStringSchema } from "@/domain/schema/time";
import { TravelLegSchema } from "@/domain/schema/travel";

// Same ISO-date pattern used by TripPreferencesSchema (src/domain/schema/tripPreferences.ts).
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date string (YYYY-MM-DD)")
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Expected a valid calendar date",
  });

export const ActivitySchema = z.object({
  placeId: z.string().min(1),
  start: TimeStringSchema,
  end: TimeStringSchema,
  note: z.string().optional(),
  /**
   * The hop taken to REACH this activity, when there was one. Absent on the
   * first stop of a day with no known lodging to depart from, and on any hop
   * the planner measured as zero minutes.
   */
  travel: TravelLegSchema.optional(),
});

export const DayPlanSchema = z.object({
  date: isoDateSchema,
  activities: z.array(ActivitySchema),
});

export const ItinerarySchema = z.object({
  days: z.array(DayPlanSchema).min(1),
});

export type Activity = z.infer<typeof ActivitySchema>;
export type { TravelLeg, TravelMode } from "@/domain/schema/travel";
export type DayPlan = z.infer<typeof DayPlanSchema>;
export type Itinerary = z.infer<typeof ItinerarySchema>;
