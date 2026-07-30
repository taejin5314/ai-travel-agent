"use server";

import { TripPreferencesSchema } from "@/domain/schema/tripPreferences";
import { validateTripPreferences } from "@/validators/tripPreferences";
import {
  buildTripPreferencesCandidate,
  extractFormValues,
  translateSchemaErrors,
  translateValidationErrors,
  type PlanFormState,
} from "./formPreferences";

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

  return { status: "success", data: parsed.data };
}
