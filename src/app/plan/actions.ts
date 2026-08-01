"use server";

import { planTrip } from "@/agent/planTrip";
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
  translateValidationErrors,
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

  return {
    status: "success",
    data: parsed.data,
    dataSource: ports.dataSource,
    itinerary: buildItineraryView(plan.itinerary, await ports.places.listPlaces()),
  };
}
