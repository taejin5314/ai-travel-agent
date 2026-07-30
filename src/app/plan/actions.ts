"use server";

import { planTrip } from "@/agent/planTrip";
import type { Itinerary } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
import { TripPreferencesSchema } from "@/domain/schema/tripPreferences";
import { MockPlacesProvider } from "@/providers/mock/places";
import { MockRoutesProvider } from "@/providers/mock/routes";
import { validateTripPreferences } from "@/validators/tripPreferences";
import {
  buildTripPreferencesCandidate,
  extractFormValues,
  translateSchemaErrors,
  translateValidationErrors,
  type ItineraryViewDay,
  type PlanFormState,
} from "./formPreferences";

// Composition root: the server action owns provider construction and hands
// ports to the agent (UI components never touch providers directly).
const ports = {
  places: new MockPlacesProvider(),
  routes: new MockRoutesProvider(),
};

function buildItineraryView(
  itinerary: Itinerary,
  places: Place[],
): ItineraryViewDay[] {
  const placeById = new Map(places.map((p) => [p.id, p]));
  return itinerary.days.map((day) => ({
    date: day.date,
    items: day.activities.map((activity) => {
      const place = placeById.get(activity.placeId);
      return {
        placeName: place?.name ?? activity.placeId,
        start: activity.start,
        end: activity.end,
        kind: (place?.category === "restaurant" ? "meal" : "visit") as
          | "meal"
          | "visit",
        rating: place?.rating,
      };
    }),
  }));
}

export async function submitTripPreferences(
  _prevState: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  const values = extractFormValues(formData);
  const candidate = buildTripPreferencesCandidate(formData);
  const parsed = TripPreferencesSchema.safeParse(candidate);

  if (!parsed.success) {
    return {
      status: "error",
      errors: translateSchemaErrors(parsed.error),
      values,
    };
  }

  const validation = validateTripPreferences(parsed.data);
  if (!validation.ok) {
    return {
      status: "error",
      errors: translateValidationErrors(validation.errors),
      values,
    };
  }

  const plan = await planTrip(parsed.data, ports);
  if (!plan.ok) {
    return {
      status: "success",
      data: parsed.data,
      planningNotice: plan.errors.join(" "),
    };
  }

  return {
    status: "success",
    data: parsed.data,
    itinerary: buildItineraryView(plan.itinerary, await ports.places.listPlaces()),
  };
}
