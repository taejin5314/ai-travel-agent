import { describe, expect, it } from "vitest";
import { submitTripPreferences } from "@/app/plan/actions";
import { initialPlanFormState } from "@/app/plan/formPreferences";

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
  interests: "food",
  pace: "balanced",
  constraints: "",
};

describe("submitTripPreferences", () => {
  it("returns the parsed TripPreferences on success", async () => {
    const result = await submitTripPreferences(
      initialPlanFormState,
      buildFormData(validFields),
    );

    expect(result).toEqual({
      status: "success",
      data: {
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        lodging: { name: "Hotel Osaka", area: "Namba" },
        partySize: 2,
        mustVisit: ["Osaka Castle", "Dotonbori"],
        interests: ["food"],
        pace: "balanced",
        constraints: undefined,
      },
    });
  });

  it("returns Korean field errors when the shape is invalid (schema failure)", async () => {
    const result = await submitTripPreferences(
      initialPlanFormState,
      buildFormData({ ...validFields, partySize: "0" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errors.some((error) => error.includes("인원 수"))).toBe(
        true,
      );
    }
  });

  it("returns a Korean business-rule error when endDate is before startDate", async () => {
    const result = await submitTripPreferences(
      initialPlanFormState,
      buildFormData({
        ...validFields,
        startDate: "2026-08-05",
        endDate: "2026-08-01",
      }),
    );

    expect(result).toEqual({
      status: "error",
      errors: ["종료일은 시작일과 같거나 이후여야 합니다."],
      values: {
        startDate: "2026-08-05",
        endDate: "2026-08-01",
        lodgingName: "Hotel Osaka",
        lodgingArea: "Namba",
        partySize: "2",
        mustVisit: "Osaka Castle, Dotonbori",
        interests: "food",
        pace: "balanced",
        constraints: "",
      },
    });
  });

  it("returns a Korean business-rule error for duplicate mustVisit entries", async () => {
    const result = await submitTripPreferences(
      initialPlanFormState,
      buildFormData({
        ...validFields,
        mustVisit: "Osaka Castle, osaka castle",
      }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errors.some((error) => error.includes("중복"))).toBe(
        true,
      );
    }
  });

  it("preserves the submitted field values when schema validation fails, so the form can restore them", async () => {
    const result = await submitTripPreferences(
      initialPlanFormState,
      buildFormData({ ...validFields, partySize: "0", lodgingName: "Hotel Kyoto" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.values).toEqual({
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        lodgingName: "Hotel Kyoto",
        lodgingArea: "Namba",
        partySize: "0",
        mustVisit: "Osaka Castle, Dotonbori",
        interests: "food",
        pace: "balanced",
        constraints: "",
      });
    }
  });

  it("preserves the submitted field values when a business rule fails, including untrimmed textarea entries", async () => {
    const result = await submitTripPreferences(
      initialPlanFormState,
      buildFormData({
        ...validFields,
        startDate: "2026-08-05",
        endDate: "2026-08-01",
        mustVisit: "Osaka Castle,\nDotonbori",
      }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.values.mustVisit).toBe("Osaka Castle,\nDotonbori");
      expect(result.values.startDate).toBe("2026-08-05");
      expect(result.values.endDate).toBe("2026-08-01");
    }
  });
});
