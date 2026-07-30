import { describe, expect, it } from "vitest";
import type { Place } from "@/domain/schema/place";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import {
  mapInterestsToCategories,
  planTrip,
  PACE_MAX_ACTIVITIES_PER_DAY,
} from "@/agent/planTrip";
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
    aliases: ["오사카성"],
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

  it("resolves a partial must-visit name without a spurious internal error", async () => {
    // Regression: coverage used to be checked against the raw user string
    // ("castle"), which never equals the scheduled place name exactly.
    const result = await planTrip(
      { ...preferences, mustVisit: ["castle"] },
      makePorts(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.itinerary.days.flatMap((d) =>
        d.activities.map((a) => a.placeId),
      );
      expect(ids).toContain("osaka-castle");
    }
  });

  it("resolves a Korean alias must-visit name", async () => {
    const result = await planTrip(
      { ...preferences, mustVisit: ["오사카성"] },
      makePorts(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.itinerary.days.flatMap((d) =>
        d.activities.map((a) => a.placeId),
      );
      expect(ids).toContain("osaka-castle");
    }
  });

  it("prioritizes Korean interests via category mapping", async () => {
    // 음식 → food: the market should be scheduled ahead of non-interest places.
    const result = await planTrip(
      { ...preferences, mustVisit: [], interests: ["음식"], pace: "relaxed" },
      makePorts(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const firstDayIds = result.itinerary.days[0].activities.map(
        (a) => a.placeId,
      );
      expect(firstDayIds[0]).toBe("kuromon-market");
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

describe("mapInterestsToCategories", () => {
  it("maps Korean keywords and English category names, ignoring unknowns", () => {
    const categories = mapInterestsToCategories(["음식", " Shopping ", "우주"]);
    expect(categories).toEqual(new Set(["food", "shopping"]));
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
