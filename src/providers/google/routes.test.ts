import { describe, expect, it, vi } from "vitest";
import type { Place } from "@/domain/schema/place";
import { GoogleRoutesProvider } from "@/providers/google/routes";
import { MockRoutesProvider } from "@/providers/mock/routes";

const daily = { open: "09:00", close: "18:00" };

function place(id: string, lat: number, lng: number): Place {
  return {
    id,
    name: id,
    area: "osaka",
    category: "sight",
    location: { lat, lng },
    openingHours: [daily, daily, daily, daily, daily, daily, daily],
    typicalVisitMinutes: 60,
  };
}

// ~600m apart in central Osaka.
const nearA = place("near-a", 34.6687, 135.5013);
const nearB = place("near-b", 34.6712, 135.5063);
// Osaka → Kyoto, ~40km apart.
const farAway = place("far", 35.0089, 135.7667);

function fakeFetch(durationSeconds: number | null) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () =>
      durationSeconds === null
        ? {}
        : { routes: [{ duration: `${durationSeconds}s` }] },
  }));
}

describe("GoogleRoutesProvider", () => {
  it("converts route durations to whole minutes, rounding up", async () => {
    const provider = new GoogleRoutesProvider({
      apiKey: "k",
      fetchFn: fakeFetch(605), // 10.08 min
    });
    expect(await provider.travelMinutes(nearA, nearB, "walk")).toBe(11);
  });

  it("caches by (from, to, mode)", async () => {
    const fetchFn = fakeFetch(300);
    const provider = new GoogleRoutesProvider({ apiKey: "k", fetchFn });

    await provider.travelMinutes(nearA, nearB, "transit");
    await provider.travelMinutes(nearA, nearB, "transit");
    expect(fetchFn.mock.calls.length).toBe(1);

    await provider.travelMinutes(nearA, nearB, "walk");
    expect(fetchFn.mock.calls.length).toBe(2); // different mode = new call
  });

  it("skips the API for unreasonably long walks and uses the deterministic estimate", async () => {
    const fetchFn = fakeFetch(1);
    const provider = new GoogleRoutesProvider({ apiKey: "k", fetchFn });

    const minutes = await provider.travelMinutes(nearA, farAway, "walk");
    expect(fetchFn.mock.calls.length).toBe(0);
    expect(minutes).toBe(
      await new MockRoutesProvider().travelMinutes(nearA, farAway, "walk"),
    );
  });

  it("falls back to the deterministic estimate when Google returns no route", async () => {
    const provider = new GoogleRoutesProvider({
      apiKey: "k",
      fetchFn: fakeFetch(null),
    });
    const minutes = await provider.travelMinutes(nearA, nearB, "transit");
    expect(minutes).toBe(
      await new MockRoutesProvider().travelMinutes(nearA, nearB, "transit"),
    );
  });

  it("returns 1 minute for identical places without calling the API", async () => {
    const fetchFn = fakeFetch(999);
    const provider = new GoogleRoutesProvider({ apiKey: "k", fetchFn });
    expect(await provider.travelMinutes(nearA, nearA, "walk")).toBe(1);
    expect(fetchFn.mock.calls.length).toBe(0);
  });
});
