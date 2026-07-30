import { describe, expect, it } from "vitest";
import type { Place } from "@/domain/schema/place";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import { planTrip, PACE_MAX_ACTIVITIES_PER_DAY } from "@/agent/planTrip";
import { MockPlacesProvider } from "@/providers/mock/places";
import { MockRoutesProvider } from "@/providers/mock/routes";
import { LLM_MODEL_ID, StubLlmProvider } from "@/providers/llm/stub";
import { validateItinerary } from "@/validators/itinerary";

const daily = { open: "09:00", close: "18:00" };

// 2026-10-05 = Monday, 2026-10-06 = Tuesday, 2026-10-07 = Wednesday.
const fixture: Place[] = [
  {
    id: "osaka-castle",
    name: "Osaka Castle",
    area: "osaka",
    category: "sight",
    location: { lat: 34.6873, lng: 135.5262 },
    openingHours: [daily, daily, daily, daily, daily, daily, daily],
    typicalVisitMinutes: 120,
  },
  {
    id: "kuromon-market",
    name: "Kuromon Market",
    area: "osaka",
    category: "food",
    location: { lat: 34.6654, lng: 135.5063 },
    // Closed on Wednesday (index 2).
    openingHours: [daily, daily, null, daily, daily, daily, daily],
    typicalVisitMinutes: 60,
  },
  {
    id: "fushimi-inari",
    name: "Fushimi Inari Taisha",
    area: "kyoto",
    category: "culture",
    location: { lat: 34.9671, lng: 135.7727 },
    openingHours: [daily, daily, daily, daily, daily, daily, daily],
    typicalVisitMinutes: 90,
  },
];

const preferences: TripPreferences = {
  startDate: "2026-10-05",
  endDate: "2026-10-06",
  lodging: { name: "Hotel Namba", area: "Namba" },
  partySize: 2,
  mustVisit: ["Osaka Castle"],
  interests: ["food"],
  pace: "balanced",
};

function makePorts() {
  return {
    places: new MockPlacesProvider(fixture),
    routes: new MockRoutesProvider(),
  };
}

describe("planTrip", () => {
  it("produces an itinerary that passes validateItinerary", async () => {
    const result = await planTrip(preferences, makePorts());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        validateItinerary(result.itinerary, fixture, preferences),
      ).toEqual({ ok: true });
    }
  });

  it("is deterministic: same input, same itinerary", async () => {
    const first = await planTrip(preferences, makePorts());
    const second = await planTrip(preferences, makePorts());
    expect(first).toEqual(second);
  });

  it("schedules every must-visit place", async () => {
    const result = await planTrip(preferences, makePorts());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.itinerary.days.flatMap((d) =>
        d.activities.map((a) => a.placeId),
      );
      expect(ids).toContain("osaka-castle");
    }
  });

  it("respects the pace cap per day", async () => {
    for (const pace of ["relaxed", "balanced", "packed"] as const) {
      const result = await planTrip({ ...preferences, pace }, makePorts());
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const day of result.itinerary.days) {
          expect(day.activities.length).toBeLessThanOrEqual(
            PACE_MAX_ACTIVITIES_PER_DAY[pace],
          );
        }
      }
    }
  });

  it("never schedules a place on its closed day", async () => {
    // Trip is Wednesday only; the market is closed on Wednesday.
    const wednesdayOnly: TripPreferences = {
      ...preferences,
      startDate: "2026-10-07",
      endDate: "2026-10-07",
      mustVisit: [],
      interests: [],
    };
    const result = await planTrip(wednesdayOnly, makePorts());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.itinerary.days.flatMap((d) =>
        d.activities.map((a) => a.placeId),
      );
      expect(ids).not.toContain("kuromon-market");
    }
  });

  it("fails with a clear error when a must-visit place is unknown", async () => {
    const result = await planTrip(
      { ...preferences, mustVisit: ["Atlantis"] },
      makePorts(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("Atlantis"))).toBe(true);
    }
  });

  it("rejects invalid preferences before planning", async () => {
    const result = await planTrip(
      { ...preferences, startDate: "2026-10-06", endDate: "2026-10-05" },
      makePorts(),
    );
    expect(result.ok).toBe(false);
  });
});

describe("StubLlmProvider", () => {
  it("pins the future model id", () => {
    expect(LLM_MODEL_ID).toBe("claude-fable-5");
  });

  it("throws until the LLM phase is enabled", async () => {
    await expect(new StubLlmProvider().draftItinerary()).rejects.toThrow(
      /not enabled/,
    );
  });
});
