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

const searchResponse = {
  places: [osakaAttraction, kyotoRestaurant, tokyoPlace, noHoursPlace],
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
    expect(callsAfterFirst).toBe(3); // attractions + restaurants + hotels

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
