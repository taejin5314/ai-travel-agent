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

describe("planTrip area clustering", () => {
  it("keeps each day within a single area when capacity allows", async () => {
    const twoAreas: Place[] = [
      fixture[0], // osaka-castle (osaka)
      fixture[1], // kuromon-market (osaka)
      fixture[2], // fushimi-inari (kyoto)
      {
        id: "kinkaku-ji",
        name: "Kinkaku-ji",
        area: "kyoto",
        category: "culture",
        location: { lat: 35.0394, lng: 135.7292 },
        openingHours: [daily, daily, daily, daily, daily, daily, daily],
        typicalVisitMinutes: 90,
      },
    ];
    const result = await planTrip(
      {
        ...preferences,
        mustVisit: [],
        interests: [],
        pace: "relaxed", // 2 activities/day → 2 osaka places day 1, 2 kyoto day 2
      },
      {
        places: new MockPlacesProvider(twoAreas),
        routes: new MockRoutesProvider(),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const areaById = new Map(twoAreas.map((p) => [p.id, p.area]));
      for (const day of result.itinerary.days) {
        const areas = new Set(
          day.activities.map((a) => areaById.get(a.placeId)),
        );
        expect(areas.size).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("planTrip meals, ratings, and lodging anchor", () => {
  // Restaurants keep realistic evening hours so dinner slots fit.
  const eats = { open: "11:00", close: "22:00" };
  const osakaRamen: Place = {
    id: "osaka-ramen",
    name: "Osaka Ramen",
    area: "osaka",
    category: "restaurant",
    location: { lat: 34.6688, lng: 135.5014 },
    openingHours: [eats, eats, eats, eats, eats, eats, eats],
    typicalVisitMinutes: 45,
    rating: 4.5,
    reviewCount: 1000,
  };
  const osakaSushi: Place = {
    id: "osaka-sushi",
    name: "Osaka Sushi",
    area: "osaka",
    category: "restaurant",
    location: { lat: 34.67, lng: 135.502 },
    openingHours: [eats, eats, eats, eats, eats, eats, eats],
    typicalVisitMinutes: 45,
    rating: 4.0,
    reviewCount: 800,
  };
  const hotelNamba: Place = {
    id: "hotel-namba",
    name: "Hotel Namba",
    area: "osaka",
    category: "lodging",
    location: { lat: 34.6664, lng: 135.5013 },
    openingHours: [daily, daily, daily, daily, daily, daily, daily],
    typicalVisitMinutes: 1,
    rating: 4.2,
    reviewCount: 500,
  };
  const mealFixture: Place[] = [...fixture, osakaRamen, osakaSushi, hotelNamba];

  function makeMealPorts(catalog: Place[] = mealFixture) {
    return {
      places: new MockPlacesProvider(catalog),
      routes: new MockRoutesProvider(),
    };
  }

  it("inserts lunch and dinner slots that pass validation", async () => {
    // relaxed keeps day 1 in Osaka, so both meal slots are reachable.
    const relaxed: TripPreferences = { ...preferences, pace: "relaxed" };
    const result = await planTrip(relaxed, makeMealPorts());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        validateItinerary(result.itinerary, mealFixture, relaxed),
      ).toEqual({ ok: true });
      const day = result.itinerary.days[0];
      const meals = day.activities.filter((a) =>
        ["osaka-ramen", "osaka-sushi"].includes(a.placeId),
      );
      expect(meals).toHaveLength(2);
      const [lunch, dinner] = meals;
      expect(lunch.start >= "12:00").toBe(true);
      expect(dinner.start >= "17:30").toBe(true);
    }
  });

  it("does not count meals toward the pace cap", async () => {
    const result = await planTrip(
      { ...preferences, pace: "relaxed" },
      makeMealPorts(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const day of result.itinerary.days) {
        const attractions = day.activities.filter(
          (a) => !["osaka-ramen", "osaka-sushi"].includes(a.placeId),
        );
        expect(attractions.length).toBeLessThanOrEqual(
          PACE_MAX_ACTIVITIES_PER_DAY.relaxed,
        );
      }
      const dayOneTotal = result.itinerary.days[0].activities.length;
      expect(dayOneTotal).toBeGreaterThan(PACE_MAX_ACTIVITIES_PER_DAY.relaxed);
    }
  });

  it("picks the higher-rated restaurant for the first meal", async () => {
    const result = await planTrip(preferences, makeMealPorts());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mealIds = result.itinerary.days[0].activities
        .filter((a) => ["osaka-ramen", "osaka-sushi"].includes(a.placeId))
        .map((a) => a.placeId);
      expect(mealIds[0]).toBe("osaka-ramen"); // 4.5 > 4.0
    }
  });

  it("prefers higher-rated attractions when no interests are set", async () => {
    const lowSight: Place = {
      ...fixture[0],
      id: "low-sight",
      name: "Low Sight",
      aliases: [],
      rating: 3.0,
    };
    const highSight: Place = {
      ...fixture[0],
      id: "high-sight",
      name: "High Sight",
      aliases: [],
      rating: 4.9,
    };
    const result = await planTrip(
      { ...preferences, mustVisit: [], interests: [] },
      makeMealPorts([lowSight, highSight]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.itinerary.days[0].activities[0].placeId).toBe("high-sight");
    }
  });

  it("anchors the first stop to the lodging's area when the lodging is known", async () => {
    // Kyoto place listed first: without the anchor it would start the day.
    const kyotoFirst: Place[] = [fixture[2], fixture[0], hotelNamba];
    const result = await planTrip(
      { ...preferences, mustVisit: [], interests: [] },
      makeMealPorts(kyotoFirst),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.itinerary.days[0].activities[0].placeId).toBe(
        "osaka-castle",
      );
    }
  });

  it("plans without an anchor when the lodging is not in the catalog", async () => {
    const result = await planTrip(
      { ...preferences, lodging: { name: "Unknown Inn", area: "?" } },
      makeMealPorts(),
    );
    expect(result.ok).toBe(true);
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
