import { z } from "zod";

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
  partySize: z.number().int().min(1),
  mustVisit: z.array(z.string().min(1)),
  interests: z.array(z.string()),
  pace: z.enum(["relaxed", "balanced", "packed"]),
  constraints: z.array(z.string()).optional(),
});

export type TripPreferences = z.infer<typeof TripPreferencesSchema>;
