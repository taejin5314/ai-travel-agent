"use server";

import { discoverPlaces } from "@/agent/discoverPlaces";
import { planTrip } from "@/agent/planTrip";
import { serviceableDestinations } from "@/domain/coverage";
import { itineraryStore } from "@/db/store";
import { TripPreferencesSchema } from "@/domain/schema/tripPreferences";
import { googleMapsApiKey } from "@/lib/config";
import { GooglePlacesProvider } from "@/providers/google/places";
import { GoogleRoutesProvider } from "@/providers/google/routes";
import { MockPlacesProvider } from "@/providers/mock/places";
import { MockRoutesProvider } from "@/providers/mock/routes";
import { validateTripPreferences } from "@/validators/tripPreferences";
import {
  buildItineraryView,
  buildTripPreferencesCandidate,
  extractFormValues,
  translateSchemaErrors,
  toCandidateView,
  translateValidationErrors,
  type CandidateView,
  type PlanFormState,
} from "./formPreferences";

// Composition root: the server action owns provider construction and hands
// ports to the agent (UI components never touch providers directly).
// With GOOGLE_MAPS_API_KEY set, real Places/Routes data is used; without it
// the app runs fully on the mock catalog (dev, CI, and tests stay offline).
function buildPorts() {
  const apiKey = googleMapsApiKey();
  if (apiKey !== undefined) {
    return {
      dataSource: "google" as const,
      places: new GooglePlacesProvider({ apiKey }),
      routes: new GoogleRoutesProvider({ apiKey }),
    };
  }
  return {
    dataSource: "mock" as const,
    places: new MockPlacesProvider(),
    routes: new MockRoutesProvider(),
  };
}
const ports = buildPorts();

/**
 * Candidates to show on the picker, for destinations the probe found
 * serviceable. Everything comes back as a view model rather than a domain
 * Place: the client only ever needs a pin and a label, and shipping the whole
 * catalog over the wire would leak more than the UI can use.
 */
export async function discoverCandidates(input: {
  destinations: readonly string[];
  cuisines?: readonly string[];
  limit?: number;
}): Promise<{ attractions: CandidateView[]; restaurants: CandidateView[] }> {
  const available = new Set(serviceableDestinations().map((entry) => entry.id));
  const destinations = input.destinations.filter((id) => available.has(id));
  if (destinations.length === 0) {
    return { attractions: [], restaurants: [] };
  }
  const found = await discoverPlaces(ports.places, destinations, {
    ...(input.cuisines !== undefined && { cuisines: input.cuisines }),
    ...(input.limit !== undefined && { limit: input.limit }),
  });
  return {
    attractions: found.attractions.map(toCandidateView),
    restaurants: found.restaurants.map(toCandidateView),
  };
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

  let plan: Awaited<ReturnType<typeof planTrip>>;
  try {
    plan = await planTrip(parsed.data, ports);
  } catch {
    // External API failure (quota, network, key). Never leak details to the
    // client; the preferences themselves were valid.
    return {
      status: "success",
      data: parsed.data,
      dataSource: ports.dataSource,
      planningNotice:
        "장소 데이터를 불러오지 못해 일정을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }
  if (!plan.ok) {
    return {
      status: "success",
      data: parsed.data,
      dataSource: ports.dataSource,
      planningNotice: plan.errors.join(" "),
    };
  }

  // Keep only the places this itinerary actually references, so the shared
  // page can render without calling Google again. The planner returns the
  // places it used — including any a cuisine search pulled in, which are not
  // in the catalog.
  const catalog = plan.places;
  const scheduledIds = new Set(
    plan.itinerary.days.flatMap((day) => day.activities.map((a) => a.placeId)),
  );
  const saved = await itineraryStore.save({
    preferences: parsed.data,
    itinerary: plan.itinerary,
    places: catalog.filter((place) => scheduledIds.has(place.id)),
    dataSource: ports.dataSource,
  });

  return {
    status: "success",
    data: parsed.data,
    dataSource: ports.dataSource,
    itinerary: buildItineraryView(plan.itinerary, catalog, parsed.data.partySize),
    planId: saved.id,
  };
}
