import { describe, expect, it, vi } from "vitest";
import { GooglePlacesProvider } from "@/providers/google/places";

type FetchCall = { url: string; init?: RequestInit };

function fakeFetch(body: unknown, calls: FetchCall[] = []) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => body };
  });
}

// Osaka Castle-like attraction: Google days are 0 = Sunday .. 6 = Saturday.
const osakaAttraction = {
  id: "gp-osaka-castle",
  displayName: { text: "오사카성" },
  location: { latitude: 34.6873, longitude: 135.5262 },
  formattedAddress: "1-1 Osakajo, Chuo Ward, Osaka",
  rating: 4.5,
  userRatingCount: 68000,
  types: ["historical_landmark", "tourist_attraction"],
  regularOpeningHours: {
    periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      open: { day, hour: 9, minute: 0 },
      close: { day, hour: 17, minute: 30 },
    })),
  },
};

const kyotoRestaurant = {
  id: "gp-katsukura",
  displayName: { text: "카츠쿠라 산조" },
  location: { latitude: 35.0089, longitude: 135.7667 },
  rating: 4.4,
  userRatingCount: 8900,
  types: ["restaurant"],
  regularOpeningHours: {
    periods: [
      // Sunday (0) overnight close → clamped; Monday (1) missing → closed.
      { open: { day: 0, hour: 11, minute: 0 }, close: { day: 1, hour: 1, minute: 0 } },
      { open: { day: 2, hour: 11, minute: 0 }, close: { day: 2, hour: 21, minute: 30 } },
    ],
  },
};

// Tokyo Tower: outside the Kansai bounding boxes — must be dropped.
const tokyoPlace = {
  id: "gp-tokyo-tower",
  displayName: { text: "도쿄 타워" },
  location: { latitude: 35.6586, longitude: 139.7454 },
  types: ["tourist_attraction"],
};

// No opening hours at all → assumed always open.
const noHoursPlace = {
  id: "gp-kamo-river",
  displayName: { text: "가모가와" },
  location: { latitude: 35.0116, longitude: 135.7681 },
  types: ["park"],
};

// Google's 24/7 encoding: one period, Sunday 00:00, no close.
const alwaysOpenPlace = {
  id: "gp-fushimi-inari",
  displayName: { text: "후시미 이나리 신사" },
  location: { latitude: 34.9671, longitude: 135.7727 },
  rating: 4.6,
  userRatingCount: 110000,
  types: ["shinto_shrine", "tourist_attraction"],
  regularOpeningHours: {
    periods: [{ open: { day: 0, hour: 0, minute: 0 } }],
  },
};

const searchResponse = {
  places: [
    osakaAttraction,
    kyotoRestaurant,
    tokyoPlace,
    noHoursPlace,
    alwaysOpenPlace,
  ],
};

describe("GooglePlacesProvider", () => {
  it("maps Google places to validated domain Places and drops out-of-region results", async () => {
    const provider = new GooglePlacesProvider({
      apiKey: "test-key",
      fetchFn: fakeFetch(searchResponse),
    });
    const places = await provider.findPlacesByName("오사카성");

    expect(places.map((p) => p.id)).toEqual([
      "gp-osaka-castle",
      "gp-katsukura",
      "gp-kamo-river",
      "gp-fushimi-inari",
    ]);

    const castle = places[0];
    expect(castle.area).toBe("osaka");
    expect(castle.category).toBe("culture"); // historical_landmark wins
    expect(castle.rating).toBe(4.5);
    // Google Sunday(0) 09:00-17:30 → our index 6 (Sun); Monday(1) → index 0.
    expect(castle.openingHours[6]).toEqual({ open: "09:00", close: "17:30" });
    expect(castle.openingHours[0]).toEqual({ open: "09:00", close: "17:30" });

    const restaurant = places[1];
    expect(restaurant.area).toBe("kyoto");
    expect(restaurant.category).toBe("restaurant");
    // Sunday overnight close (closes Monday 01:00) clamps to 23:59.
    expect(restaurant.openingHours[6]).toEqual({ open: "11:00", close: "23:59" });
    // Tuesday window mapped to index 1.
    expect(restaurant.openingHours[1]).toEqual({ open: "11:00", close: "21:30" });
    // Monday: no period → closed.
    expect(restaurant.openingHours[0]).toBeNull();

    const river = places[2];
    expect(river.category).toBe("nature");
    expect(river.openingHours[3]).toEqual({ open: "00:00", close: "23:59" });
  });

  it("treats Google's single open-ended period as open 24/7, not Sunday-only", () => {
    // Regression: real data stranded Fushimi Inari (open 24 hours) because a
    // lone Sunday-00:00 period with no close read as "closed Mon-Sat".
    const provider = new GooglePlacesProvider({
      apiKey: "k",
      fetchFn: fakeFetch({ places: [alwaysOpenPlace] }),
    });
    return provider.findPlacesByName("후시미").then((places) => {
      expect(places).toHaveLength(1);
      for (const window of places[0].openingHours) {
        expect(window).toEqual({ open: "00:00", close: "23:59" });
      }
    });
  });

  it("does not read a lone non-Sunday open-ended period as 24/7", async () => {
    // Only Google's documented 24/7 shape (Sunday 00:00, no close) means
    // "always open". A single open-ended Wednesday period is a data anomaly
    // and must stay a Wednesday-only window.
    const anomaly = {
      ...alwaysOpenPlace,
      id: "gp-anomaly",
      regularOpeningHours: {
        periods: [{ open: { day: 3, hour: 9, minute: 0 } }],
      },
    };
    const provider = new GooglePlacesProvider({
      apiKey: "k",
      fetchFn: fakeFetch({ places: [anomaly] }),
    });
    const places = await provider.findPlacesByName("anomaly");
    expect(places[0].openingHours[2]).toEqual({
      open: "09:00",
      close: "23:59",
    });
    expect(places[0].openingHours.filter((w) => w !== null)).toHaveLength(1);
  });

  it("sends the API key and field mask headers, never in the URL", async () => {
    const calls: FetchCall[] = [];
    const provider = new GooglePlacesProvider({
      apiKey: "test-key",
      fetchFn: fakeFetch(searchResponse, calls),
    });
    await provider.findPlacesByName("castle");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain("test-key");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(headers["X-Goog-FieldMask"]).toContain("places.regularOpeningHours");
  });

  it("caches the area catalog: repeated listPlaces does not refetch", async () => {
    const fetchFn = fakeFetch(searchResponse);
    const provider = new GooglePlacesProvider({ apiKey: "k", fetchFn });

    await provider.listPlaces("osaka");
    const callsAfterFirst = fetchFn.mock.calls.length;
    expect(callsAfterFirst).toBe(5); // attractions + 3 food queries + hotels

    await provider.listPlaces("osaka");
    expect(fetchFn.mock.calls.length).toBe(callsAfterFirst);
  });

  it("serves getPlaceById from cache after a search", async () => {
    const fetchFn = fakeFetch(searchResponse);
    const provider = new GooglePlacesProvider({ apiKey: "k", fetchFn });
    await provider.findPlacesByName("anything");

    const cached = await provider.getPlaceById("gp-osaka-castle");
    expect(cached?.name).toBe("오사카성");
    expect(fetchFn.mock.calls.length).toBe(1); // no extra request
  });

  it("throws a keyless error on HTTP failure", async () => {
    const provider = new GooglePlacesProvider({
      apiKey: "secret-key",
      fetchFn: vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({}),
      })),
    });
    await expect(provider.findPlacesByName("castle")).rejects.toThrow(
      /HTTP 403/,
    );
    await expect(provider.findPlacesByName("castle")).rejects.not.toThrow(
      /secret-key/,
    );
  });
});

describe("GooglePlacesProvider typing and durations", () => {
  const osakaCastle = {
    id: "gp-castle",
    displayName: { text: "오사카 성" },
    location: { latitude: 34.6873, longitude: 135.5262 },
    rating: 4.4,
    userRatingCount: 98269,
    // Real shape: primaryType says castle, but `museum` rides along in types.
    primaryType: "castle",
    types: ["castle", "tourist_attraction", "museum", "historical_place"],
  };
  const alleyShrine = {
    id: "gp-hozenji",
    displayName: { text: "호젠지" },
    location: { latitude: 34.6684, longitude: 135.5031 },
    rating: 4.4,
    userRatingCount: 4467,
    primaryType: "buddhist_temple",
    types: ["buddhist_temple", "tourist_attraction", "place_of_worship"],
  };

  async function place(raw: unknown) {
    const provider = new GooglePlacesProvider({
      apiKey: "k",
      fetchFn: fakeFetch({ places: [raw] }),
    });
    return (await provider.findPlacesByName("x"))[0];
  }

  it("lets primaryType win over the types soup", async () => {
    // Regression: `museum` outranked `tourist_attraction` in the fallback
    // order, so Osaka Castle was filed as culture and given 75 minutes.
    const castle = await place(osakaCastle);
    expect(castle.category).toBe("sight");
    expect(castle.typicalVisitMinutes).toBe(120);
  });

  it("gives an alley shrine and a castle materially different visits", async () => {
    const [castle, shrine] = [await place(osakaCastle), await place(alleyShrine)];
    expect(shrine.typicalVisitMinutes).toBe(45);
    expect(castle.typicalVisitMinutes).toBeGreaterThan(
      shrine.typicalVisitMinutes * 2,
    );
  });

  it("falls back to types when primaryType is absent", async () => {
    const withoutPrimary: Record<string, unknown> = { ...osakaCastle };
    delete withoutPrimary.primaryType;
    const castle = await place(withoutPrimary);
    // `castle` is still in types, so the type table still finds it.
    expect(castle.typicalVisitMinutes).toBe(120);
  });

  it("falls back to the category default for an unrecognised place", async () => {
    const odd = await place({
      ...osakaCastle,
      primaryType: "wedding_venue",
      types: ["wedding_venue"],
    });
    expect(odd.category).toBe("sight");
    expect(odd.typicalVisitMinutes).toBe(90);
  });

  it("requests primaryType from the API", async () => {
    const fetchFn = fakeFetch({ places: [osakaCastle] });
    const provider = new GooglePlacesProvider({ apiKey: "k", fetchFn });
    await provider.findPlacesByName("x");
    const headers = (fetchFn.mock.calls[0][1] as { headers: Record<string, string> })
      .headers;
    expect(headers["X-Goog-FieldMask"]).toContain("primaryType");
  });
});

describe("GooglePlacesProvider generic types", () => {
  it("does not let a generic primaryType outrank a specific type", async () => {
    // 구로몬 시장 really comes back as primaryType `tourist_attraction` with
    // `market` behind it. Taking the primary at face value filed a food
    // market as a generic sight, which also removed it from the "음식"
    // interest.
    const provider = new GooglePlacesProvider({
      apiKey: "k",
      fetchFn: fakeFetch({
        places: [
          {
            id: "gp-kuromon",
            displayName: { text: "구로몬 시장" },
            location: { latitude: 34.6654, longitude: 135.5063 },
            primaryType: "tourist_attraction",
            types: ["tourist_attraction", "market", "point_of_interest"],
          },
        ],
      }),
    });
    const market = (await provider.findPlacesByName("구로몬"))[0];
    expect(market.category).toBe("food");
    expect(market.typicalVisitMinutes).toBe(60);
  });

  it("still uses the catch-all when nothing specific is offered", async () => {
    const provider = new GooglePlacesProvider({
      apiKey: "k",
      fetchFn: fakeFetch({
        places: [
          {
            id: "gp-vague",
            displayName: { text: "무언가" },
            location: { latitude: 34.67, longitude: 135.5 },
            primaryType: "tourist_attraction",
            types: ["tourist_attraction", "point_of_interest"],
          },
        ],
      }),
    });
    const vague = (await provider.findPlacesByName("무언가"))[0];
    expect(vague.category).toBe("sight");
    expect(vague.typicalVisitMinutes).toBe(60);
  });
});

describe("GooglePlacesProvider cuisine queries", () => {
  function capturingProvider() {
    const queries: string[] = [];
    const provider = new GooglePlacesProvider({
      apiKey: "k",
      fetchFn: async (_url, init) => {
        const body = JSON.parse((init as { body: string }).body) as {
          textQuery: string;
        };
        queries.push(body.textQuery);
        return { ok: true, status: 200, json: async () => ({ places: [] }) };
      },
    });
    return { provider, queries };
  }

  it("searches a cuisine only where the destination offers it", async () => {
    // Regression: the cuisine list was a global enum, so an Osaka+Kyoto trip
    // asking for kaiseki ran "kaiseki restaurants in Osaka".
    const { provider, queries } = capturingProvider();
    await provider.findRestaurants(["kaiseki"]);

    expect(queries).toEqual([
      "traditional kaiseki restaurants in Kyoto, Japan",
    ]);
  });

  it("runs a shared cuisine once per destination that offers it", async () => {
    const { provider, queries } = capturingProvider();
    await provider.findRestaurants(["ramen"], "osaka");

    expect(queries).toEqual(["famous ramen restaurants in Osaka, Japan"]);
  });

  it("searches nothing when no chosen destination offers the cuisine", async () => {
    const { provider, queries } = capturingProvider();
    await provider.findRestaurants(["kaiseki"], "paris");

    expect(queries).toEqual([]);
  });
});
