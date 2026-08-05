import { describe, expect, it } from "vitest";
import type { ItineraryStore, NewPlan } from "@/db/ports";
import { SavedPlanSchema } from "@/domain/schema/savedPlan";

/**
 * What any `ItineraryStore` must do, written once.
 *
 * These tests belonged to the in-memory class and were already prefaced with
 * "the interface, not the class". Now that a second adapter exists that claim
 * has to be enforceable, so the suite lives here and both stores run it. A
 * behaviour that only the memory store has — unguessable ids, a `get` that
 * returns null rather than throwing — is a behaviour the app would lose
 * silently on the day it switched to Postgres.
 *
 * Not a `.test.ts` file on purpose: it defines tests, it does not own any.
 */

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

export const contractPlan = plan;

/** Async because a real database needs setting up before the first query. */
export type StoreFactory = (options: {
  now: () => Date;
}) => Promise<ItineraryStore>;

export function describeItineraryStore(name: string, createStore: StoreFactory): void {
  const fixedNow = () => new Date("2026-08-02T00:00:00Z");
  const makeStore = () => createStore({ now: fixedNow });

  describe(`${name} (ItineraryStore contract)`, () => {
    it("round-trips a saved plan", async () => {
      const store = await makeStore();
      const saved = await store.save(plan);
      await expect(store.get(saved.id)).resolves.toEqual(saved);
    });

    it("produces a record that satisfies SavedPlanSchema", async () => {
      const saved = await (await makeStore()).save(plan);
      expect(SavedPlanSchema.safeParse(saved).success).toBe(true);
    });

    it("returns null for an unknown id instead of throwing", async () => {
      await expect((await makeStore()).get("does-not-exist")).resolves.toBeNull();
    });

    it("issues unguessable, non-sequential, non-colliding ids", async () => {
      const store = await makeStore();
      const ids = new Set<string>();
      for (let i = 0; i < 50; i += 1) {
        ids.add((await store.save(plan)).id);
      }
      expect(ids.size).toBe(50);
      for (const id of ids) {
        // Long enough not to be enumerable, and URL-safe.
        expect(id).toMatch(/^[A-Za-z0-9_-]{16,}$/);
        expect(Number.isNaN(Number(id))).toBe(true);
      }
    });

    it("keeps plans separate", async () => {
      const store = await makeStore();
      const first = await store.save(plan);
      const second = await store.save({
        ...plan,
        preferences: { ...plan.preferences, partySize: 4 },
      });
      expect((await store.get(first.id))?.preferences.partySize).toBe(2);
      expect((await store.get(second.id))?.preferences.partySize).toBe(4);
    });

    it("stamps createdAt from the injected clock", async () => {
      const saved = await (await makeStore()).save(plan);
      expect(saved.createdAt).toBe("2026-08-02T00:00:00.000Z");
    });

    it("preserves non-ASCII text exactly", async () => {
      // 오사카성 survives a JSON round trip through the wire encoding, or the
      // must-visit list a traveller typed comes back as mojibake.
      const store = await makeStore();
      const saved = await store.save(plan);
      expect((await store.get(saved.id))?.preferences.mustVisit).toEqual(["오사카성"]);
    });
  });
}
