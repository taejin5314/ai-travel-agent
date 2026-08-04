import { describe, expect, it } from "vitest";
import { MemoryItineraryStore } from "@/db/memory";
import type { ItineraryStore, NewPlan } from "@/db/ports";
import { SavedPlanSchema } from "@/domain/schema/savedPlan";

const plan: NewPlan = {
  preferences: {
    startDate: "2026-10-06",
    endDate: "2026-10-07",
    lodging: { name: "Cross Hotel Osaka", area: "Namba" },
    destinations: ["osaka", "kyoto"],
  partySize: 2,
    mustVisit: ["오사카성"],
    interests: ["음식"],
    pace: "balanced",
  },
  itinerary: {
    days: [
      {
        date: "2026-10-06",
        activities: [{ placeId: "osaka-castle", start: "09:30", end: "11:00" }],
      },
    ],
  },
  places: [
    {
      id: "osaka-castle",
      name: "Osaka Castle",
      area: "osaka",
      category: "sight",
      location: { lat: 34.6873, lng: 135.5262 },
      openingHours: [
        { open: "09:00", close: "17:00" },
        { open: "09:00", close: "17:00" },
        { open: "09:00", close: "17:00" },
        { open: "09:00", close: "17:00" },
        { open: "09:00", close: "17:00" },
        { open: "09:00", close: "17:00" },
        { open: "09:00", close: "17:00" },
      ],
      typicalVisitMinutes: 90,
    },
  ],
  dataSource: "mock",
};

// The interface, not the class: swapping in a real database later must not
// require rewriting these.
function makeStore(): ItineraryStore {
  return new MemoryItineraryStore({ now: () => new Date("2026-08-02T00:00:00Z") });
}

describe("MemoryItineraryStore", () => {
  it("round-trips a saved plan", async () => {
    const store = makeStore();
    const saved = await store.save(plan);
    await expect(store.get(saved.id)).resolves.toEqual(saved);
  });

  it("produces a record that satisfies SavedPlanSchema", async () => {
    const saved = await makeStore().save(plan);
    expect(SavedPlanSchema.safeParse(saved).success).toBe(true);
  });

  it("returns null for an unknown id instead of throwing", async () => {
    await expect(makeStore().get("does-not-exist")).resolves.toBeNull();
  });

  it("issues unguessable, non-sequential, non-colliding ids", async () => {
    const store = makeStore();
    const ids = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      ids.add((await store.save(plan)).id);
    }
    expect(ids.size).toBe(200);
    for (const id of ids) {
      // Long enough not to be enumerable, and URL-safe.
      expect(id).toMatch(/^[A-Za-z0-9_-]{16,}$/);
      expect(Number.isNaN(Number(id))).toBe(true);
    }
  });

  it("keeps plans separate", async () => {
    const store = makeStore();
    const first = await store.save(plan);
    const second = await store.save({
      ...plan,
      preferences: { ...plan.preferences, partySize: 4 },
    });
    const fetched = await store.get(first.id);
    expect(fetched?.preferences.partySize).toBe(2);
    expect((await store.get(second.id))?.preferences.partySize).toBe(4);
  });

  it("stamps createdAt from the injected clock", async () => {
    const saved = await makeStore().save(plan);
    expect(saved.createdAt).toBe("2026-08-02T00:00:00.000Z");
  });
});
