import { describe, expect, it } from "vitest";
import {
  buildTripPreferencesCandidate,
  translateSchemaErrors,
  translateValidationErrors,
} from "@/app/plan/formPreferences";
import { TripPreferencesSchema } from "@/domain/schema/tripPreferences";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

const validFields = {
  startDate: "2026-08-01",
  endDate: "2026-08-05",
  lodgingName: "Hotel Osaka",
  lodgingArea: "Namba",
  partySize: "2",
  mustVisit: "Osaka Castle, Dotonbori",
  interests: "food\nshopping",
  pace: "balanced",
  constraints: "",
};

describe("buildTripPreferencesCandidate", () => {
  it("maps FormData fields to a TripPreferences-shaped candidate", () => {
    const candidate = buildTripPreferencesCandidate(buildFormData(validFields));

    expect(candidate).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      lodging: { name: "Hotel Osaka", area: "Namba" },
      partySize: 2,
      mustVisit: ["Osaka Castle", "Dotonbori"],
      interests: ["food", "shopping"],
      pace: "balanced",
      constraints: undefined,
    });
  });

  it("splits multi-entry fields on commas and newlines, trimming whitespace", () => {
    const candidate = buildTripPreferencesCandidate(
      buildFormData({ ...validFields, mustVisit: " Osaka Castle ,\nDotonbori,, " }),
    );

    expect((candidate as { mustVisit: string[] }).mustVisit).toEqual([
      "Osaka Castle",
      "Dotonbori",
    ]);
  });

  it("omits constraints when the field is blank", () => {
    const candidate = buildTripPreferencesCandidate(
      buildFormData({ ...validFields, constraints: "  " }),
    );

    expect((candidate as { constraints?: string[] }).constraints).toBeUndefined();
  });

  it("parses constraints when provided", () => {
    const candidate = buildTripPreferencesCandidate(
      buildFormData({ ...validFields, constraints: "no early mornings, budget-friendly" }),
    );

    expect((candidate as { constraints?: string[] }).constraints).toEqual([
      "no early mornings",
      "budget-friendly",
    ]);
  });

  it("produces a candidate that passes TripPreferencesSchema when input is valid", () => {
    const candidate = buildTripPreferencesCandidate(buildFormData(validFields));
    const result = TripPreferencesSchema.safeParse(candidate);
    expect(result.success).toBe(true);
  });
});

describe("translateSchemaErrors", () => {
  it("returns a Korean message referencing the offending field", () => {
    const result = TripPreferencesSchema.safeParse(
      buildTripPreferencesCandidate(buildFormData({ ...validFields, partySize: "0" })),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = translateSchemaErrors(result.error);
      expect(messages.some((message) => message.includes("인원 수"))).toBe(true);
    }
  });
});

describe("translateValidationErrors", () => {
  it("translates the endDate-before-startDate business error", () => {
    const messages = translateValidationErrors([
      "endDate must be the same day as or after startDate.",
    ]);
    expect(messages).toEqual(["종료일은 시작일과 같거나 이후여야 합니다."]);
  });

  it("translates the duplicate mustVisit business error, preserving entries", () => {
    const messages = translateValidationErrors([
      "mustVisit contains duplicate entries: Osaka Castle.",
    ]);
    expect(messages[0]).toContain("Osaka Castle");
    expect(messages[0]).toContain("중복");
  });

  it("translates the partySize-out-of-range business error", () => {
    const messages = translateValidationErrors([
      "partySize must be between 1 and 20.",
    ]);
    expect(messages[0]).toContain("인원 수");
  });

  it("falls back to the original message for unrecognized errors", () => {
    const messages = translateValidationErrors(["some unmapped error."]);
    expect(messages).toEqual(["some unmapped error."]);
  });
});
