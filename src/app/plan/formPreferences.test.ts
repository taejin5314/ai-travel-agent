import { describe, expect, it } from "vitest";
import {
  buildItineraryView,
  CONSTRAINT_OPTIONS,
  buildTripPreferencesCandidate,
  extractFormValues,
  translateSchemaErrors,
  translateValidationErrors,
} from "@/app/plan/formPreferences";
import type { Place } from "@/domain/schema/place";
import { TripPreferencesSchema } from "@/domain/schema/tripPreferences";

// Constraints are checkboxes: several values under one name, so an array
// field is appended rather than set.
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
  destinations: ["osaka", "kyoto"],
  partySize: "2",
  mustVisit: "Osaka Castle, Dotonbori",
  interests: "food\nshopping",
  pace: "balanced",
  cuisines: [] as string[],
  constraints: [] as string[],
};

describe("buildTripPreferencesCandidate", () => {
  it("maps FormData fields to a TripPreferences-shaped candidate", () => {
    const candidate = buildTripPreferencesCandidate(buildFormData(validFields));

    expect(candidate).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      lodging: { name: "Hotel Osaka", area: "Namba" },
      destinations: ["osaka", "kyoto"],
      partySize: 2,
      mustVisit: ["Osaka Castle", "Dotonbori"],
      interests: ["food", "shopping"],
      pace: "balanced",
      cuisines: undefined,
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

  it("omits constraints when no box is checked", () => {
    const candidate = buildTripPreferencesCandidate(
      buildFormData({ ...validFields, constraints: [] }),
    );

    expect((candidate as { constraints?: string[] }).constraints).toBeUndefined();
  });

  it("collects every checked constraint", () => {
    const candidate = buildTripPreferencesCandidate(
      buildFormData({
        ...validFields,
        constraints: ["late-start", "less-walking"],
      }),
    );

    expect((candidate as { constraints?: string[] }).constraints).toEqual([
      "late-start",
      "less-walking",
    ]);
  });

  it("rejects a constraint the planner does not implement", () => {
    // The form only ever submits known values; a hand-crafted POST must not
    // sneak a constraint past the schema and be silently ignored downstream.
    const candidate = buildTripPreferencesCandidate(
      buildFormData({ ...validFields, constraints: ["budget-friendly"] }),
    );

    expect(TripPreferencesSchema.safeParse(candidate).success).toBe(false);
  });

  it("accepts every constraint the form offers", () => {
    const candidate = buildTripPreferencesCandidate(
      buildFormData({
        ...validFields,
        constraints: CONSTRAINT_OPTIONS.map((option) => option.value),
      }),
    );

    expect(TripPreferencesSchema.safeParse(candidate).success).toBe(true);
  });

  it("produces a candidate that passes TripPreferencesSchema when input is valid", () => {
    const candidate = buildTripPreferencesCandidate(buildFormData(validFields));
    const result = TripPreferencesSchema.safeParse(candidate);
    expect(result.success).toBe(true);
  });
});

describe("extractFormValues", () => {
  it("returns the raw submitted strings, unsplit, for restoring the form after an error", () => {
    const values = extractFormValues(
      buildFormData({
        ...validFields,
        mustVisit: " Osaka Castle ,\nDotonbori,, ",
        cuisines: [],
      constraints: ["late-start"],
      }),
    );

    expect(values).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      lodgingName: "Hotel Osaka",
      lodgingArea: "Namba",
      destinations: ["osaka", "kyoto"],
      partySize: "2",
      mustVisit: "Osaka Castle ,\nDotonbori,,",
      interests: "food\nshopping",
      pace: "balanced",
      cuisines: [],
      constraints: ["late-start"],
    });
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

  it("translates the trip-length-exceeded business error", () => {
    const messages = translateValidationErrors([
      "Trip length (35 days) exceeds the maximum of 30 days.",
    ]);
    expect(messages).toEqual(["여행 기간이 최대 허용 일수(30일)를 초과했습니다."]);
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

describe("buildItineraryView", () => {
  const open = { open: "09:00", close: "18:00" };
  const places: Place[] = [
    {
      id: "castle",
      name: "Osaka Castle",
      area: "osaka",
      category: "sight",
      location: { lat: 34.6873, lng: 135.5262 },
      openingHours: [open, open, open, open, open, open, open],
      typicalVisitMinutes: 120,
      rating: 4.4,
    },
    {
      id: "ramen",
      name: "Osaka Ramen",
      area: "osaka",
      category: "restaurant",
      location: { lat: 34.6688, lng: 135.5014 },
      openingHours: [open, open, open, open, open, open, open],
      typicalVisitMinutes: 45,
    },
  ];

  const itinerary = {
    days: [
      {
        date: "2026-10-05",
        activities: [
          { placeId: "castle", start: "09:30", end: "11:30" },
          {
            placeId: "ramen",
            start: "12:11",
            end: "12:56",
            travel: { minutes: 41, mode: "transit" as const },
          },
        ],
      },
    ],
  };

  it("carries the travel leg through to the view", () => {
    const [day] = buildItineraryView(itinerary, places);
    expect(day.items[0].travel).toBeUndefined();
    expect(day.items[1].travel).toEqual({ minutes: 41, mode: "transit" });
  });

  it("resolves names, ratings, and meal kind", () => {
    const [day] = buildItineraryView(itinerary, places);
    expect(day.items[0]).toMatchObject({
      placeName: "Osaka Castle",
      kind: "visit",
      rating: 4.4,
    });
    expect(day.items[1]).toMatchObject({
      placeName: "Osaka Ramen",
      kind: "meal",
    });
    expect(day.items[1].rating).toBeUndefined();
  });

  it("falls back to the place id when a place is missing from the catalog", () => {
    const [day] = buildItineraryView(itinerary, []);
    expect(day.items[0].placeName).toBe("castle");
    expect(day.items[0].kind).toBe("visit");
  });
});
