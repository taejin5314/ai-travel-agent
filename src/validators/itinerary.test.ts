import { describe, expect, it } from "vitest";
import type { Itinerary } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import { validateItinerary } from "@/validators/itinerary";

const daily = { open: "09:00", close: "18:00" } as const;

// 2026-10-05 is a Monday; 2026-10-06 a Tuesday; 2026-10-07 a Wednesday.
const castle: Place = {
  id: "osaka-castle",
  name: "Osaka Castle",
  area: "osaka",
  category: "sight",
  location: { lat: 34.6873, lng: 135.5262 },
  openingHours: [daily, daily, daily, daily, daily, daily, daily],
  typicalVisitMinutes: 120,
};

// Closed on Wednesday (index 2), like Nishiki-style market closures.
const market: Place = {
  id: "kuromon-market",
  name: "Kuromon Market",
  area: "osaka",
  category: "food",
  location: { lat: 34.6654, lng: 135.5063 },
  openingHours: [daily, daily, null, daily, daily, daily, daily],
  typicalVisitMinutes: 60,
};

const places: Place[] = [castle, market];

const preferences: TripPreferences = {
  startDate: "2026-10-05",
  endDate: "2026-10-07",
  lodging: { name: "Hotel Namba", area: "Namba" },
  partySize: 2,
  mustVisit: ["Osaka Castle"],
  interests: ["food"],
  pace: "balanced",
};

const validItinerary: Itinerary = {
  days: [
    {
      date: "2026-10-05",
      activities: [
        { placeId: "osaka-castle", start: "09:30", end: "11:30" },
        { placeId: "kuromon-market", start: "12:00", end: "13:00" },
      ],
    },
    {
      date: "2026-10-06",
      activities: [{ placeId: "kuromon-market", start: "10:00", end: "11:00" }],
    },
  ],
};

function expectErrors(result: ReturnType<typeof validateItinerary>): string[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe("validateItinerary", () => {
  it("passes for a valid itinerary", () => {
    expect(validateItinerary(validItinerary, places, preferences)).toEqual({
      ok: true,
    });
  });

  it("fails when a day falls outside the trip range", () => {
    const itinerary: Itinerary = {
      days: [
        {
          date: "2026-10-08",
          activities: [{ placeId: "osaka-castle", start: "09:30", end: "11:30" }],
        },
      ],
    };
    const errors = expectErrors(validateItinerary(itinerary, places, preferences));
    expect(errors.some((e) => e.includes("outside the trip range"))).toBe(true);
  });

  it("fails when day dates are duplicated or descending", () => {
    const itinerary: Itinerary = {
      days: [
        {
          date: "2026-10-06",
          activities: [{ placeId: "osaka-castle", start: "09:30", end: "10:30" }],
        },
        {
          date: "2026-10-05",
          activities: [{ placeId: "osaka-castle", start: "09:30", end: "10:30" }],
        },
      ],
    };
    const errors = expectErrors(validateItinerary(itinerary, places, preferences));
    expect(errors.some((e) => e.includes("strictly ascending"))).toBe(true);
  });

  it("fails when an activity ends before it starts", () => {
    const itinerary: Itinerary = {
      days: [
        {
          date: "2026-10-05",
          activities: [{ placeId: "osaka-castle", start: "11:00", end: "10:00" }],
        },
      ],
    };
    const errors = expectErrors(validateItinerary(itinerary, places, preferences));
    expect(errors.some((e) => e.includes("must start before it ends"))).toBe(true);
  });

  it("fails when activities overlap", () => {
    const itinerary: Itinerary = {
      days: [
        {
          date: "2026-10-05",
          activities: [
            { placeId: "osaka-castle", start: "09:30", end: "11:30" },
            { placeId: "kuromon-market", start: "11:00", end: "12:00" },
          ],
        },
      ],
    };
    const errors = expectErrors(validateItinerary(itinerary, places, preferences));
    expect(errors.some((e) => e.includes("overlaps"))).toBe(true);
  });

  it("fails when activities are not sorted by start time", () => {
    const itinerary: Itinerary = {
      days: [
        {
          date: "2026-10-05",
          activities: [
            { placeId: "kuromon-market", start: "14:00", end: "15:00" },
            { placeId: "osaka-castle", start: "09:30", end: "11:30" },
          ],
        },
      ],
    };
    const errors = expectErrors(validateItinerary(itinerary, places, preferences));
    expect(errors.some((e) => e.includes("sorted by start time"))).toBe(true);
  });

  it("fails for an unknown placeId", () => {
    const itinerary: Itinerary = {
      days: [
        {
          date: "2026-10-05",
          activities: [{ placeId: "no-such-place", start: "09:30", end: "10:30" }],
        },
      ],
    };
    const errors = expectErrors(validateItinerary(itinerary, places, preferences));
    expect(errors.some((e) => e.includes('Unknown placeId "no-such-place"'))).toBe(
      true,
    );
  });

  it("fails when visiting a place on its closed day", () => {
    // 2026-10-07 is a Wednesday; the market's Wednesday slot is null.
    const itinerary: Itinerary = {
      days: [
        {
          date: "2026-10-07",
          activities: [{ placeId: "kuromon-market", start: "10:00", end: "11:00" }],
        },
      ],
    };
    const errors = expectErrors(validateItinerary(itinerary, places, preferences));
    expect(errors.some((e) => e.includes("closed on Wednesday"))).toBe(true);
  });

  it("fails when a visit falls outside opening hours", () => {
    const itinerary: Itinerary = {
      days: [
        {
          date: "2026-10-05",
          activities: [{ placeId: "osaka-castle", start: "17:30", end: "19:00" }],
        },
      ],
    };
    const errors = expectErrors(validateItinerary(itinerary, places, preferences));
    expect(errors.some((e) => e.includes("outside opening hours"))).toBe(true);
  });

  it("fails when a must-visit place is never scheduled", () => {
    const itinerary: Itinerary = {
      days: [
        {
          date: "2026-10-05",
          activities: [{ placeId: "kuromon-market", start: "10:00", end: "11:00" }],
        },
      ],
    };
    const errors = expectErrors(validateItinerary(itinerary, places, preferences));
    expect(
      errors.some((e) => e.includes("Must-visit places are not scheduled")),
    ).toBe(true);
  });

  it("matches must-visit names case-insensitively with whitespace trimmed", () => {
    const result = validateItinerary(validItinerary, places, {
      ...preferences,
      mustVisit: ["  osaka castle  "],
    });
    expect(result).toEqual({ ok: true });
  });

  it("collects multiple errors in one pass", () => {
    const itinerary: Itinerary = {
      days: [
        {
          date: "2026-10-08",
          activities: [{ placeId: "no-such-place", start: "11:00", end: "10:00" }],
        },
      ],
    };
    const errors = expectErrors(validateItinerary(itinerary, places, preferences));
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
