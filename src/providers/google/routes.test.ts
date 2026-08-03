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
    expect(await provider.travelMinutes(nearA, nearB, "walk")).toEqual({
      minutes: 11,
      mode: "walk",
      estimated: false,
    });
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

    const estimate = await provider.travelMinutes(nearA, farAway, "walk");
    expect(fetchFn.mock.calls.length).toBe(0);
    expect(estimate).toEqual(
      await new MockRoutesProvider().travelMinutes(nearA, farAway, "walk"),
    );
    expect(estimate.estimated).toBe(true);
  });

  it("falls back to the deterministic estimate when Google returns no route", async () => {
    const provider = new GoogleRoutesProvider({
      apiKey: "k",
      fetchFn: fakeFetch(null),
    });
    const estimate = await provider.travelMinutes(nearA, nearB, "transit");
    expect(estimate).toEqual(
      await new MockRoutesProvider().travelMinutes(nearA, nearB, "transit"),
    );
    expect(estimate.estimated).toBe(true);
  });

  it("reports no journey at all for identical places, without calling the API", async () => {
    const fetchFn = fakeFetch(999);
    const provider = new GoogleRoutesProvider({ apiKey: "k", fetchFn });
    expect(await provider.travelMinutes(nearA, nearA, "walk")).toEqual({
      minutes: 0,
      mode: "walk",
      estimated: false,
    });
    expect(fetchFn.mock.calls.length).toBe(0);
  });
});

describe("GoogleRoutesProvider mode honesty", () => {
  function fetchRoute(durationSeconds: number, stepModes: string[]) {
    return vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        routes: [
          {
            duration: `${durationSeconds}s`,
            legs: [{ steps: stepModes.map((travelMode) => ({ travelMode })) }],
          },
        ],
      }),
    }));
  }

  it("does not answer a transit question with an hour-long walk", async () => {
    // Observed live: asking TRANSIT for Osaka Castle → Dotonbori returns the
    // walking route (59 min / 4.3 km, all 13 steps WALK). That measurement is
    // real but answers a different question, and scheduling it would put a
    // traveller on foot for an hour between two places a train connects.
    const provider = new GoogleRoutesProvider({
      apiKey: "k",
      fetchFn: fetchRoute(3554, ["WALK", "WALK", "WALK"]),
    });
    const estimate = await provider.travelMinutes(nearA, nearB, "transit");
    expect(estimate).toEqual(
      await new MockRoutesProvider().travelMinutes(nearA, nearB, "transit"),
    );
    expect(estimate.mode).toBe("transit");
    expect(estimate.estimated).toBe(true);
    expect(estimate.minutes).toBeLessThan(60);
  });

  it("keeps transit when the route actually contains a ride", async () => {
    const provider = new GoogleRoutesProvider({
      apiKey: "k",
      fetchFn: fetchRoute(1200, ["WALK", "TRANSIT", "WALK"]),
    });
    expect(await provider.travelMinutes(nearA, nearB, "transit")).toEqual({
      minutes: 20,
      mode: "transit",
      estimated: false,
    });
  });

  it("does not infer walking from a route with no step detail", async () => {
    // Absent steps mean we do not know, and inventing an answer is the
    // behaviour this change removes.
    const provider = new GoogleRoutesProvider({
      apiKey: "k",
      fetchFn: fetchRoute(1200, []),
    });
    const estimate = await provider.travelMinutes(nearA, nearB, "transit");
    expect(estimate.mode).toBe("transit");
    expect(estimate.estimated).toBe(false);
  });

  it("asks for the step modes it needs to tell them apart", async () => {
    const calls: { headers: Record<string, string> }[] = [];
    const provider = new GoogleRoutesProvider({
      apiKey: "k",
      fetchFn: async (_url, init) => {
        calls.push(init as { headers: Record<string, string> });
        return {
          ok: true,
          status: 200,
          json: async () => ({ routes: [{ duration: "600s" }] }),
        };
      },
    });
    await provider.travelMinutes(nearA, nearB, "transit");

    expect(calls[0].headers["X-Goog-FieldMask"]).toContain(
      "routes.legs.steps.travelMode",
    );
  });
});
