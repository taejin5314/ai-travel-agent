import { z } from "zod";
import { ItinerarySchema } from "@/domain/schema/itinerary";
import { PlaceSchema } from "@/domain/schema/place";
import { TripPreferencesSchema } from "@/domain/schema/tripPreferences";

/**
 * A generated plan, stored so it survives a refresh and can be shared.
 *
 * `places` holds only the places the itinerary references, not the whole
 * catalog: the saved page has to render names, ratings and categories without
 * calling Google again, which would cost quota and could return different
 * data than the plan was built from.
 */
export const SavedPlanSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  preferences: TripPreferencesSchema,
  itinerary: ItinerarySchema,
  places: z.array(PlaceSchema),
  dataSource: z.enum(["google", "mock"]),
});

export type SavedPlan = z.infer<typeof SavedPlanSchema>;
