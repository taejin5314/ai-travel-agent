import { describe, expect, it } from "vitest";
import type { Place } from "@/domain/schema/place";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import {
  mapInterestsToCategories,
  planTrip,
  PACE_MAX_ACTIVITIES_PER_DAY,
  ratingScore,
} from "@/agent/planTrip";
import type { RoutesPort } from "@/providers/ports";
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

  it("groups must-visits by area instead of following input order", async () => {
    // Regression: must-visits outrank area preference so they are never
    // starved, but ranking them purely by input order made an alternating
    // list (Osaka, Kyoto, Osaka) ping-pong across cities inside one day.
    const lodging: Place = {
      id: "hotel-namba",
      name: "Hotel Namba",
      area: "osaka",
      category: "lodging",
      location: { lat: 34.6664, lng: 135.5013 },
      openingHours: [daily, daily, daily, daily, daily, daily, daily],
      typicalVisitMinutes: 1,
    };
    const result = await planTrip(
      {
        ...preferences,
        startDate: "2026-10-05",
        endDate: "2026-10-05",
        mustVisit: ["Osaka Castle", "Fushimi Inari Taisha", "Kuromon Market"],
        interests: [],
      },
      {
        places: new MockPlacesProvider([...fixture, lodging]),
        routes: new MockRoutesProvider(),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.itinerary.days[0].activities.map((a) => a.placeId);
      expect(ids).toEqual([
        "osaka-castle",
        "kuromon-market",
        "fushimi-inari",
      ]);
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
    // Equal review counts, so the rating itself decides.
    const lowSight: Place = {
      ...fixture[0],
      id: "low-sight",
      name: "Low Sight",
      aliases: [],
      rating: 3.0,
      reviewCount: 5000,
    };
    const highSight: Place = {
      ...fixture[0],
      id: "high-sight",
      name: "High Sight",
      aliases: [],
      rating: 4.9,
      reviewCount: 5000,
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

  it("prefers a well-reviewed restaurant over a thinly-reviewed higher rating", async () => {
    const thin: Place = {
      ...osakaRamen,
      id: "thin-4-9",
      name: "Thin 4.9",
      rating: 4.9,
      reviewCount: 25,
    };
    const solid: Place = {
      ...osakaSushi,
      id: "solid-4-5",
      name: "Solid 4.5",
      rating: 4.5,
      reviewCount: 40000,
    };
    const result = await planTrip(
      { ...preferences, pace: "relaxed" },
      makeMealPorts([...fixture, thin, solid, hotelNamba]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mealIds = result.itinerary.days[0].activities
        .filter((a) => ["thin-4-9", "solid-4-5"].includes(a.placeId))
        .map((a) => a.placeId);
      expect(mealIds[0]).toBe("solid-4-5");
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

describe("ratingScore", () => {
  const base: Place = {
    id: "x",
    name: "X",
    area: "osaka",
    category: "restaurant",
    location: { lat: 34.6, lng: 135.5 },
    openingHours: [daily, daily, daily, daily, daily, daily, daily],
    typicalVisitMinutes: 60,
  };

  it("ranks a well-reviewed 4.5 above a thinly-reviewed 4.9", () => {
    const thin = { ...base, id: "thin", rating: 4.9, reviewCount: 30 };
    const solid = { ...base, id: "solid", rating: 4.5, reviewCount: 60000 };
    expect(ratingScore(solid)).toBeGreaterThan(ratingScore(thin));
  });

  it("still prefers the higher rating when review counts are comparable", () => {
    const good = { ...base, id: "good", rating: 4.6, reviewCount: 5000 };
    const worse = { ...base, id: "worse", rating: 4.1, reviewCount: 5000 };
    expect(ratingScore(good)).toBeGreaterThan(ratingScore(worse));
  });

  it("scores unrated places lowest", () => {
    expect(ratingScore(base)).toBe(0);
  });
});

describe("planTrip travel legs", () => {
  const hotel: Place = {
    id: "hotel-namba",
    name: "Hotel Namba",
    area: "osaka",
    category: "lodging",
    location: { lat: 34.6664, lng: 135.5013 },
    openingHours: [daily, daily, daily, daily, daily, daily, daily],
    typicalVisitMinutes: 1,
  };
  // ~100 m from the hotel: comfortably under MAX_WALK_MINUTES.
  const nearby: Place = {
    id: "nearby-sight",
    name: "Nearby Sight",
    area: "osaka",
    category: "sight",
    location: { lat: 34.667, lng: 135.502 },
    openingHours: [daily, daily, daily, daily, daily, daily, daily],
    typicalVisitMinutes: 60,
  };
  // Kyoto: far enough that walking is out of the question.
  const faraway: Place = {
    id: "faraway-sight",
    name: "Faraway Sight",
    area: "kyoto",
    category: "culture",
    location: { lat: 34.9671, lng: 135.7727 },
    openingHours: [daily, daily, daily, daily, daily, daily, daily],
    typicalVisitMinutes: 60,
  };
  const oneDay: TripPreferences = {
    ...preferences,
    endDate: preferences.startDate,
    mustVisit: [],
    interests: [],
  };

  function plan(overrides: Partial<TripPreferences> = {}) {
    return planTrip(
      { ...oneDay, ...overrides },
      {
        places: new MockPlacesProvider([hotel, nearby, faraway]),
        routes: new MockRoutesProvider(),
      },
    );
  }

  it("records the mode the planner actually chose for each hop", async () => {
    const result = await plan();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const [first, second] = result.itinerary.days[0].activities;
      expect(first.placeId).toBe("nearby-sight");
      expect(first.travel?.mode).toBe("walk");
      expect(second.placeId).toBe("faraway-sight");
      expect(second.travel?.mode).toBe("transit");
      expect(second.travel!.minutes).toBeGreaterThan(first.travel!.minutes);
    }
  });

  it("reports every leg as a positive whole number of minutes", async () => {
    const result = await plan();
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const activity of result.itinerary.days[0].activities) {
        if (activity.travel !== undefined) {
          expect(Number.isInteger(activity.travel.minutes)).toBe(true);
          expect(activity.travel.minutes).toBeGreaterThan(0);
        }
      }
    }
  });

  it("gives the first stop of a day the leg from the lodging", async () => {
    const result = await plan();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.itinerary.days[0].activities[0].travel).toBeDefined();
    }
  });

  it("omits the leg when a stop follows itself", async () => {
    // With one restaurant and no attractions, the meal pool falls back to
    // revisiting it, so dinner follows lunch at the same place. Both route
    // providers answer 1 minute for identical ids, which would otherwise show
    // up as a fictitious one-minute walk.
    const eats = { open: "11:00", close: "22:00" };
    const onlyRestaurant: Place = {
      id: "solo-diner",
      name: "Solo Diner",
      area: "osaka",
      category: "restaurant",
      location: { lat: 34.6688, lng: 135.5014 },
      openingHours: [eats, eats, eats, eats, eats, eats, eats],
      typicalVisitMinutes: 45,
      rating: 4.5,
    };
    const result = await planTrip(oneDay, {
      places: new MockPlacesProvider([hotel, onlyRestaurant]),
      routes: new MockRoutesProvider(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const activities = result.itinerary.days[0].activities;
      expect(activities.map((a) => a.placeId)).toEqual([
        "solo-diner",
        "solo-diner",
      ]);
      expect(activities[1].travel).toBeUndefined();
    }
  });

  it("omits a leg a provider reports as zero minutes", async () => {
    // The port documents a positive integer and both shipped providers floor
    // at 1, but provider output is untrusted (AGENTS.md §7): a zero must not
    // become a TravelLeg, which requires minutes > 0.
    class ZeroRoutesProvider implements RoutesPort {
      async travelMinutes(): Promise<number> {
        return 0;
      }
    }
    const result = await planTrip(oneDay, {
      places: new MockPlacesProvider([hotel, nearby, faraway]),
      routes: new ZeroRoutesProvider(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const activity of result.itinerary.days[0].activities) {
        expect(activity.travel).toBeUndefined();
      }
    }
  });

  it("omits the leg on the first stop when the lodging is not in the catalog", async () => {
    // Free-text lodging stays supported: there is simply nowhere to depart
    // from, so the itinerary must not invent a hop.
    const result = await plan({
      lodging: { name: "어딘가의 숙소", area: "Namba" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.itinerary.days[0].activities[0].travel).toBeUndefined();
    }
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
