import { describe, expect, it } from "vitest";
import type { Place } from "@/domain/schema/place";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import {
  mapInterestsToCategories,
  planTrip,
  PACE_MAX_ACTIVITIES_PER_DAY,
  ratingScore,
  scheduleBoundsFor,
} from "@/agent/planTrip";
import type { RoutesPort, TravelEstimate } from "@/providers/ports";
import { MockPlacesProvider } from "@/providers/mock/places";
import { MockRoutesProvider } from "@/providers/mock/routes";
import { LLM_MODEL_ID, StubLlmProvider } from "@/providers/llm/stub";
import { timeToMinutes, validateItinerary } from "@/validators/itinerary";

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
  destinations: ["osaka", "kyoto"],
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
      async travelMinutes(): Promise<TravelEstimate> {
        return { minutes: 0, mode: "walk", estimated: true };
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

describe("planTrip meal placement", () => {
  const eats = { open: "11:00", close: "22:00" };
  const hotel: Place = {
    id: "hotel-namba",
    name: "Hotel Namba",
    area: "osaka",
    category: "lodging",
    location: { lat: 34.6664, lng: 135.5013 },
    openingHours: [daily, daily, daily, daily, daily, daily, daily],
    typicalVisitMinutes: 1,
  };
  function restaurant(
    id: string,
    location: Place["location"],
    area: Place["area"],
    rating: number,
  ): Place {
    return {
      id,
      name: id,
      area,
      category: "restaurant",
      location,
      openingHours: [eats, eats, eats, eats, eats, eats, eats],
      typicalVisitMinutes: 45,
      rating,
      reviewCount: 5000,
    };
  }
  const oneDay: TripPreferences = {
    ...preferences,
    endDate: preferences.startDate,
    mustVisit: [],
    interests: [],
  };

  it("prefers a nearby repeat over an unvisited restaurant across the country", async () => {
    // Regression: the pool ranked "unused" above "nearby", so once the local
    // restaurants were used the planner sent an Osaka trip to Kyoto — a
    // 159-minute transit — for lunch.
    const local = restaurant("local", { lat: 34.667, lng: 135.502 }, "osaka", 4.5);
    const faraway = restaurant("faraway", { lat: 34.9671, lng: 135.7727 }, "kyoto", 4.9);
    const result = await planTrip(oneDay, {
      places: new MockPlacesProvider([hotel, local, faraway]),
      routes: new MockRoutesProvider(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.itinerary.days[0].activities.map((a) => a.placeId);
      expect(ids).not.toContain("faraway");
      expect(ids).toContain("local");
    }
  });

  it("never sends the traveller past the meal travel ceiling", async () => {
    const faraway = restaurant("faraway", { lat: 34.9671, lng: 135.7727 }, "kyoto", 4.9);
    const result = await planTrip(oneDay, {
      places: new MockPlacesProvider([hotel, faraway]),
      routes: new MockRoutesProvider(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Nothing is reachable, so the day gets no meal rather than an expedition.
      expect(result.itinerary.days[0].activities).toEqual([]);
    }
  });

  it("spreads a day's meals across different restaurants when it can", async () => {
    const first = restaurant("first", { lat: 34.667, lng: 135.502 }, "osaka", 4.6);
    const second = restaurant("second", { lat: 34.6675, lng: 135.5025 }, "osaka", 4.4);
    const result = await planTrip(oneDay, {
      places: new MockPlacesProvider([hotel, first, second]),
      routes: new MockRoutesProvider(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.itinerary.days[0].activities.map((a) => a.placeId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("skips lunch rather than serving it in the dinner window", async () => {
    // A day built around one very long attraction: lunch cannot happen inside
    // its window, and taking it late used to displace dinner entirely.
    const allDaySight: Place = {
      id: "theme-park",
      name: "Theme Park",
      area: "osaka",
      category: "entertainment",
      location: { lat: 34.6654, lng: 135.5 },
      openingHours: [daily, daily, daily, daily, daily, daily, daily],
      typicalVisitMinutes: 8 * 60,
    };
    const diner = restaurant("diner", { lat: 34.6668, lng: 135.5016 }, "osaka", 4.5);
    const result = await planTrip(oneDay, {
      places: new MockPlacesProvider([hotel, allDaySight, diner]),
      routes: new MockRoutesProvider(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const meals = result.itinerary.days[0].activities.filter(
        (a) => a.placeId === "diner",
      );
      expect(meals).toHaveLength(1);
      // The single meal sits in the dinner window, not before it.
      expect(timeToMinutes(meals[0].start)).toBeGreaterThanOrEqual(17 * 60 + 30);
    }
  });
});

describe("planTrip constraints", () => {
  // Two places ~1.2 km apart: a walk by default, transit under less-walking.
  const hotel: Place = {
    id: "hotel-namba",
    name: "Hotel Namba",
    area: "osaka",
    category: "lodging",
    location: { lat: 34.6664, lng: 135.5013 },
    openingHours: [daily, daily, daily, daily, daily, daily, daily],
    typicalVisitMinutes: 1,
  };
  const wideOpen = { open: "00:00", close: "23:59" };
  const first: Place = {
    id: "first-stop",
    name: "First Stop",
    area: "osaka",
    category: "sight",
    location: { lat: 34.667, lng: 135.502 },
    openingHours: [
      wideOpen, wideOpen, wideOpen, wideOpen, wideOpen, wideOpen, wideOpen,
    ],
    typicalVisitMinutes: 60,
  };
  const second: Place = {
    ...first,
    id: "second-stop",
    name: "Second Stop",
    location: { lat: 34.6742, lng: 135.5093 },
  };
  const oneDay: TripPreferences = {
    ...preferences,
    endDate: preferences.startDate,
    mustVisit: [],
    interests: [],
    pace: "packed",
  };

  function plan(constraints?: TripPreferences["constraints"]) {
    return planTrip(
      { ...oneDay, ...(constraints !== undefined && { constraints }) },
      {
        places: new MockPlacesProvider([hotel, first, second]),
        routes: new MockRoutesProvider(),
      },
    );
  }

  it("starts the day later with late-start", async () => {
    const [normal, late] = [await plan(), await plan(["late-start"])];
    expect(normal.ok && late.ok).toBe(true);
    if (normal.ok && late.ok) {
      const before = normal.itinerary.days[0].activities[0].start;
      const after = late.itinerary.days[0].activities[0].start;
      expect(timeToMinutes(after)).toBeGreaterThanOrEqual(11 * 60);
      expect(timeToMinutes(after)).toBeGreaterThan(timeToMinutes(before));
    }
  });

  it("stops sightseeing earlier with early-end", async () => {
    const result = await plan(["early-end"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sights = result.itinerary.days[0].activities.filter((a) =>
        ["first-stop", "second-stop"].includes(a.placeId),
      );
      expect(sights.length).toBeGreaterThan(0);
      for (const sight of sights) {
        expect(timeToMinutes(sight.end)).toBeLessThanOrEqual(16 * 60 + 30);
      }
    }
  });

  it("switches a walkable hop to transit with less-walking", async () => {
    const [normal, easier] = [await plan(), await plan(["less-walking"])];
    expect(normal.ok && easier.ok).toBe(true);
    if (normal.ok && easier.ok) {
      const legOf = (r: typeof normal) =>
        r.ok
          ? r.itinerary.days[0].activities.find((a) => a.placeId === "second-stop")
              ?.travel
          : undefined;
      expect(legOf(normal)?.mode).toBe("walk");
      expect(legOf(easier)?.mode).toBe("transit");
    }
  });

  it("treats an empty or absent constraint list as a no-op", async () => {
    const [absent, empty] = [await plan(), await plan([])];
    expect(absent).toEqual(empty);
  });

  it("applies several constraints together", async () => {
    const result = await plan(["late-start", "less-walking"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const activities = result.itinerary.days[0].activities;
      expect(timeToMinutes(activities[0].start)).toBeGreaterThanOrEqual(11 * 60);
      const hop = activities.find((a) => a.placeId === "second-stop")?.travel;
      expect(hop?.mode).toBe("transit");
    }
  });
});

describe("scheduleBoundsFor", () => {
  it("returns the default day when nothing is constrained", () => {
    expect(scheduleBoundsFor()).toEqual({
      dayStart: 9 * 60 + 30,
      dayEnd: 18 * 60 + 30,
      maxWalkMinutes: 20,
    });
    expect(scheduleBoundsFor([])).toEqual(scheduleBoundsFor());
  });

  it("only ever tightens the day", () => {
    const base = scheduleBoundsFor();
    const all = scheduleBoundsFor(["late-start", "early-end", "less-walking"]);
    expect(all.dayStart).toBeGreaterThan(base.dayStart);
    expect(all.dayEnd).toBeLessThan(base.dayEnd);
    expect(all.maxWalkMinutes).toBeLessThan(base.maxWalkMinutes);
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

describe("planTrip cuisine preferences", () => {
  const eats = { open: "11:00", close: "22:00" };
  const hotel: Place = {
    id: "hotel-namba",
    name: "Hotel Namba",
    area: "osaka",
    category: "lodging",
    location: { lat: 34.6664, lng: 135.5013 },
    openingHours: [daily, daily, daily, daily, daily, daily, daily],
    typicalVisitMinutes: 1,
  };
  function restaurant(id: string, name: string, rating: number): Place {
    return {
      id,
      name,
      area: "osaka",
      category: "restaurant",
      location: { lat: 34.667, lng: 135.502 },
      openingHours: [eats, eats, eats, eats, eats, eats, eats],
      typicalVisitMinutes: 45,
      rating,
      reviewCount: 5000,
    };
  }
  // The sushi bar is rated lower, so only a cuisine request can put it first.
  const catalog = [
    hotel,
    restaurant("teppan", "Teppan Grill", 4.8),
    restaurant("sushi-bar", "Harukoma Sushi", 4.3),
  ];
  const oneDay: TripPreferences = {
    ...preferences,
    endDate: preferences.startDate,
    mustVisit: [],
    interests: [],
  };

  function plan(cuisines?: TripPreferences["cuisines"]) {
    return planTrip(
      { ...oneDay, ...(cuisines !== undefined && { cuisines }) },
      {
        places: new MockPlacesProvider(catalog),
        routes: new MockRoutesProvider(),
      },
    );
  }

  it("changes which restaurant is scheduled when a cuisine is requested", async () => {
    const [any, sushi] = [await plan(), await plan(["sushi"])];
    expect(any.ok && sushi.ok).toBe(true);
    if (any.ok && sushi.ok) {
      // Rating alone picks the teppan place; asking for sushi overrides it.
      expect(any.itinerary.days[0].activities[0].placeId).toBe("teppan");
      expect(sushi.itinerary.days[0].activities[0].placeId).toBe("sushi-bar");
    }
  });

  it("still feeds the traveller when nothing matches the request", async () => {
    const result = await plan(["kaiseki"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const meals = result.itinerary.days[0].activities;
      expect(meals.length).toBeGreaterThan(0);
      expect(meals[0].placeId).toBe("teppan");
    }
  });

  it("is a no-op when no cuisine is requested", async () => {
    const [absent, empty] = [await plan(), await plan([])];
    expect(absent).toEqual(empty);
  });
});

describe("planTrip beyond Osaka and Kyoto", () => {
  // The point of the destination registry: a third city needs no code change.
  // If this test ever requires touching src/, the enum was only renamed.
  const paris = { open: "09:00", close: "20:00" };
  const parisPlaces: Place[] = [
    {
      id: "louvre",
      name: "Louvre",
      area: "paris",
      category: "culture",
      location: { lat: 48.8606, lng: 2.3376 },
      openingHours: [paris, paris, paris, paris, paris, paris, paris],
      typicalVisitMinutes: 120,
      rating: 4.7,
      reviewCount: 300000,
    },
    {
      id: "orsay",
      name: "Musée d'Orsay",
      area: "paris",
      category: "culture",
      location: { lat: 48.86, lng: 2.3266 },
      openingHours: [paris, paris, paris, paris, paris, paris, paris],
      typicalVisitMinutes: 90,
      rating: 4.7,
      reviewCount: 100000,
    },
    {
      id: "bouillon",
      name: "Bouillon Chartier",
      area: "paris",
      category: "restaurant",
      location: { lat: 48.8719, lng: 2.3432 },
      openingHours: [paris, paris, paris, paris, paris, paris, paris],
      typicalVisitMinutes: 60,
      rating: 4.3,
      reviewCount: 40000,
    },
  ];

  it("plans a trip in a destination the code has never heard of", async () => {
    const result = await planTrip(
      {
        ...preferences,
        endDate: preferences.startDate,
        destinations: ["paris"],
        lodging: { name: "Hôtel", area: "Paris" },
        mustVisit: ["Louvre"],
        interests: [],
      },
      {
        places: new MockPlacesProvider(parisPlaces),
        routes: new MockRoutesProvider(),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.itinerary.days[0].activities.map((a) => a.placeId);
      expect(ids).toContain("louvre");
      expect(result.places.every((p) => p.area === "paris")).toBe(true);
    }
  });

  it("still clusters by destination when two are in play", async () => {
    const mixed = [...parisPlaces, ...fixture];
    const result = await planTrip(
      { ...preferences, mustVisit: [], interests: [], pace: "relaxed" },
      {
        places: new MockPlacesProvider(mixed),
        routes: new MockRoutesProvider(),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const areaById = new Map(mixed.map((p) => [p.id, p.area]));
      for (const day of result.itinerary.days) {
        const areas = new Set(
          day.activities
            .map((a) => areaById.get(a.placeId))
            .filter((area) => area !== undefined),
        );
        expect(areas.size).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("planTrip destination scoping", () => {
  it("fetches only the chosen destinations, never the whole registry", async () => {
    // Regression guard: the planner used to call listPlaces() with no
    // argument, which would have pulled Paris into an Osaka trip the moment
    // the registry grew past two cities.
    const asked: (string | undefined)[] = [];
    const places = new MockPlacesProvider(fixture);
    const spy = {
      listPlaces: async (area?: string) => {
        asked.push(area);
        return places.listPlaces(area);
      },
      getPlaceById: (id: string) => places.getPlaceById(id),
      findPlacesByName: (query: string) => places.findPlacesByName(query),
      findRestaurants: places.findRestaurants.bind(places),
    };
    const result = await planTrip(
      { ...preferences, destinations: ["osaka"], mustVisit: [], interests: [] },
      { places: spy, routes: new MockRoutesProvider() },
    );
    expect(result.ok).toBe(true);
    expect(asked).toEqual(["osaka"]);
    if (result.ok) {
      // Kyoto is in the fixture but was never asked for.
      expect(result.places.some((p) => p.area === "kyoto")).toBe(false);
    }
  });

  it("refuses a destination that is not offered", async () => {
    const result = await planTrip(
      { ...preferences, destinations: ["atlantis"] },
      makePorts(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("atlantis"))).toBe(true);
    }
  });
});

describe("planTrip selected places", () => {
  it("guarantees a place picked by id, without needing its name typed", async () => {
    const result = await planTrip(
      {
        ...preferences,
        endDate: preferences.startDate,
        mustVisit: [],
        interests: [],
        selectedPlaceIds: ["fushimi-inari"],
      },
      makePorts(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.itinerary.days[0].activities.map((a) => a.placeId);
      expect(ids).toContain("fushimi-inari");
    }
  });

  it("fails clearly when a picked id is not in the catalog", async () => {
    // The picker only offers real ids, but the action is a public endpoint.
    const result = await planTrip(
      { ...preferences, selectedPlaceIds: ["not-a-place"] },
      makePorts(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("not-a-place"))).toBe(true);
    }
  });

  it("does not duplicate a place that is both typed and picked", async () => {
    const result = await planTrip(
      {
        ...preferences,
        endDate: preferences.startDate,
        mustVisit: ["Osaka Castle"],
        selectedPlaceIds: ["osaka-castle"],
      },
      makePorts(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.itinerary.days[0].activities.map((a) => a.placeId);
      expect(ids.filter((id) => id === "osaka-castle")).toHaveLength(1);
    }
  });
});

describe("planTrip resolves names inside the chosen destinations", () => {
  // A name search covers the whole registry, so with several destinations
  // open the wrong city can win. Live symptom: a Seoul trip whose lodging
  // "호텔" resolved to a hotel in Kyoto anchored every day there, put every
  // Seoul stop out of travel range, and produced an empty itinerary.
  const elsewhere: Place[] = [
    {
      id: "kyoto-hotel",
      name: "호텔 교토",
      area: "kyoto",
      category: "lodging",
      location: { lat: 34.9858, lng: 135.7588 },
      openingHours: [daily, daily, daily, daily, daily, daily, daily],
      typicalVisitMinutes: 1,
    },
    {
      id: "kyoto-shrine",
      name: "전쟁기념관",
      area: "kyoto",
      category: "culture",
      location: { lat: 34.9671, lng: 135.7727 },
      openingHours: [daily, daily, daily, daily, daily, daily, daily],
      typicalVisitMinutes: 90,
    },
  ];
  const here: Place[] = [
    {
      id: "osaka-hotel",
      name: "호텔 오사카",
      area: "osaka",
      category: "lodging",
      location: { lat: 34.6664, lng: 135.5013 },
      openingHours: [daily, daily, daily, daily, daily, daily, daily],
      typicalVisitMinutes: 1,
    },
    {
      id: "osaka-memorial",
      name: "전쟁기념관",
      area: "osaka",
      category: "culture",
      location: { lat: 34.667, lng: 135.502 },
      openingHours: [daily, daily, daily, daily, daily, daily, daily],
      typicalVisitMinutes: 60,
    },
  ];

  function plan(over: Partial<TripPreferences>) {
    return planTrip(
      {
        ...preferences,
        endDate: preferences.startDate,
        destinations: ["osaka"],
        lodging: { name: "호텔", area: "Namba" },
        mustVisit: [],
        interests: [],
        ...over,
      },
      {
        places: new MockPlacesProvider([...elsewhere, ...here]),
        routes: new MockRoutesProvider(),
      },
    );
  }

  it("anchors on a lodging in the chosen destination, not another city", async () => {
    const result = await plan({ selectedPlaceIds: ["osaka-memorial"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const first = result.itinerary.days[0].activities[0];
      expect(first.placeId).toBe("osaka-memorial");
      // The anchor is what this asserts, not merely that something got
      // scheduled: the Kyoto hotel is first in the catalog, and departing
      // from it makes the first hop an intercity ride rather than a stroll
      // across Namba.
      expect(first.travel?.minutes ?? 0).toBeLessThan(15);
    }
  });

  it("resolves an ambiguous name to the chosen destination", async () => {
    const result = await plan({ mustVisit: ["전쟁기념관"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.itinerary.days[0].activities.map((a) => a.placeId);
      expect(ids).toContain("osaka-memorial");
      expect(ids).not.toContain("kyoto-shrine");
    }
  });

  it("refuses a picked id outside the chosen destinations, and says so", async () => {
    const result = await plan({ selectedPlaceIds: ["kyoto-shrine"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // It failed before this fix too, but as an internal validator error
      // about an unknown place id — the catalog never contained it. A refusal
      // has to name the place and read like an answer, not a crash.
      expect(result.errors[0]).toContain("찾지 못했습니다");
      expect(result.errors[0]).toContain("전쟁기념관");
      expect(result.errors.join(" ")).not.toContain("내부 오류");
    }
  });
});
