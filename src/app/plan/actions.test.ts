import { describe, expect, it } from "vitest";
import { submitTripPreferences } from "@/app/plan/actions";
import { buildItineraryView, initialPlanFormState } from "@/app/plan/formPreferences";
import { itineraryStore } from "@/db/store";

function buildFormData(fields: Record<string, string | string[]>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        formData.append(key, entry);
      }
    } else {
      formData.set(key, value);
    }
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
  constraints: [] as string[],
};

describe("submitTripPreferences", () => {
  it("returns the parsed TripPreferences and a generated itinerary on success", async () => {
    const result = await submitTripPreferences(
      initialPlanFormState,
      buildFormData(validFields),
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.data).toEqual({
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        lodging: { name: "Hotel Osaka", area: "Namba" },
        partySize: 2,
        mustVisit: ["Osaka Castle", "Dotonbori"],
        interests: ["food"],
        pace: "balanced",
        constraints: undefined,
      });
      expect(result.planningNotice).toBeUndefined();
      expect(result.itinerary).toBeDefined();
      if (result.itinerary) {
        expect(result.itinerary).toHaveLength(5);
        const names = result.itinerary.flatMap((day) =>
          day.items.map((item) => item.placeName),
        );
        expect(names).toContain("Osaka Castle");
        expect(names).toContain("Dotonbori");
      }
    }
  });

  it("returns a planning notice instead of an itinerary when a must-visit place is unknown", async () => {
    const result = await submitTripPreferences(
      initialPlanFormState,
      buildFormData({ ...validFields, mustVisit: "Osaka Castle, Atlantis" }),
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.itinerary).toBeUndefined();
      expect(result.planningNotice).toContain("Atlantis");
    }
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
        constraints: [] as string[],
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
        constraints: [] as string[],
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

describe("submitTripPreferences persistence", () => {
  it("saves the plan and returns a share id that resolves to the same itinerary", async () => {
    const result = await submitTripPreferences(
      initialPlanFormState,
      buildFormData(validFields),
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.planId).toBeDefined();

    const saved = await itineraryStore.get(result.planId!);
    expect(saved).not.toBeNull();
    expect(saved?.preferences).toEqual(result.data);
    expect(buildItineraryView(saved!.itinerary, saved!.places)).toEqual(
      result.itinerary,
    );
  });

  it("stores only the places the itinerary references, not the whole catalog", async () => {
    // The shared page must render without another provider call, but it has
    // no reason to carry places nobody visits.
    const result = await submitTripPreferences(
      initialPlanFormState,
      buildFormData(validFields),
    );
    if (result.status !== "success" || result.planId === undefined) {
      throw new Error("expected a saved plan");
    }
    const saved = await itineraryStore.get(result.planId);
    const scheduled = new Set(
      saved!.itinerary.days.flatMap((d) => d.activities.map((a) => a.placeId)),
    );
    expect(new Set(saved!.places.map((p) => p.id))).toEqual(scheduled);
  });

  it("does not save anything when planning fails", async () => {
    const result = await submitTripPreferences(
      initialPlanFormState,
      buildFormData({ ...validFields, mustVisit: "Atlantis" }),
    );
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.planId).toBeUndefined();
      expect(result.planningNotice).toBeDefined();
    }
  });
});
