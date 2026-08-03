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

  it("substitutes a measured driving time when transit answers with a walk", async () => {
    // Observed live: asking TRANSIT for Osaka Castle → Dotonbori returns the
    // walking route (59 min, all steps WALK). Driving the same pair measures
    // 20 minutes over the real road network — a far better stand-in for a
    // train than either the walk or a straight-line guess.
    const byMode = new Map([
      ["TRANSIT", { duration: "3554s", steps: ["WALK", "WALK"] }],
      ["DRIVE", { duration: "1200s", steps: [] as string[] }],
    ]);
    const provider = new GoogleRoutesProvider({
      apiKey: "k",
      fetchFn: async (_url, init) => {
        const body = JSON.parse((init as { body: string }).body) as {
          travelMode: string;
        };
        const answer = byMode.get(body.travelMode)!;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            routes: [
              {
                duration: answer.duration,
                legs: [
                  { steps: answer.steps.map((travelMode) => ({ travelMode })) },
                ],
              },
            ],
          }),
        };
      },
    });
    expect(await provider.travelMinutes(nearA, nearB, "transit")).toEqual({
      minutes: 20,
      mode: "transit",
      estimated: true,
    });
  });

  it("carries the line names of a real transit route", async () => {
    const provider = new GoogleRoutesProvider({
      apiKey: "k",
      fetchFn: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          routes: [
            {
              duration: "1320s",
              legs: [
                {
                  steps: [
                    { travelMode: "WALK" },
                    {
                      travelMode: "TRANSIT",
                      transitDetails: {
                        transitLine: {
                          name: "Midosuji Line",
                          nameShort: "미도스지선",
                          vehicle: { type: "SUBWAY" },
                        },
                        stopDetails: {
                          departureStop: { name: "난바" },
                          arrivalStop: { name: "우메다" },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      })),
    });
    const estimate = await provider.travelMinutes(nearA, nearB, "transit");
    expect(estimate.estimated).toBe(false);
    expect(estimate.minutes).toBe(22);
    expect(estimate.lines).toEqual([
      { line: "미도스지선", vehicle: "SUBWAY", from: "난바", to: "우메다" },
    ]);
  });

  it("drops a ride whose line has no name rather than showing a blank", async () => {
    const provider = new GoogleRoutesProvider({
      apiKey: "k",
      fetchFn: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          routes: [
            {
              duration: "600s",
              legs: [
                {
                  steps: [
                    { travelMode: "TRANSIT", transitDetails: { transitLine: {} } },
                  ],
                },
              ],
            },
          ],
        }),
      })),
    });
    const estimate = await provider.travelMinutes(nearA, nearB, "transit");
    expect(estimate.mode).toBe("transit");
    expect(estimate.lines).toBeUndefined();
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
