import { describe, expect, it } from "vitest";
import type { Place } from "@/domain/schema/place";
import { MockRoutesProvider } from "@/providers/mock/routes";

function place(id: string, lat: number, lng: number): Place {
  return {
    id,
    name: id,
    area: "osaka",
    category: "sight",
    location: { lat, lng },
    openingHours: [null, null, null, null, null, null, null],
    typicalVisitMinutes: 30,
  };
}

const osakaCastle = place("osaka-castle", 34.6873, 135.5262);
const dotonbori = place("dotonbori", 34.6687, 135.503);
const fushimiInari = place("fushimi-inari-taisha", 34.9671, 135.7727);

describe("MockRoutesProvider", () => {
  it("labels everything it returns as an estimate, never a measurement", async () => {
    const provider = new MockRoutesProvider();
    for (const mode of ["walk", "transit"] as const) {
      const estimate = await provider.travelMinutes(osakaCastle, dotonbori, mode);
      expect(estimate).toMatchObject({ mode, estimated: true });
    }
  });

  it("is deterministic: same input yields the same output", async () => {
    const provider = new MockRoutesProvider();
    const first = await provider.travelMinutes(osakaCastle, dotonbori, "walk");
    const second = await provider.travelMinutes(osakaCastle, dotonbori, "walk");
    expect(first).toEqual(second);
  });

  it("is symmetric for the same mode", async () => {
    const provider = new MockRoutesProvider();
    const aToB = await provider.travelMinutes(osakaCastle, fushimiInari, "transit");
    const bToA = await provider.travelMinutes(fushimiInari, osakaCastle, "transit");
    expect(aToB).toEqual(bToA);
  });

  it("returns a longer walk time than transit time for a far pair", async () => {
    const provider = new MockRoutesProvider();
    const walkMinutes = await provider.travelMinutes(osakaCastle, fushimiInari, "walk");
    const transitMinutes = await provider.travelMinutes(osakaCastle, fushimiInari, "transit");
    expect(walkMinutes.minutes).toBeGreaterThan(transitMinutes.minutes);
  });

  it("returns a positive integer", async () => {
    const provider = new MockRoutesProvider();
    const estimate = await provider.travelMinutes(osakaCastle, dotonbori, "walk");
    expect(Number.isInteger(estimate.minutes)).toBe(true);
    expect(estimate.minutes).toBeGreaterThan(0);
  });

  it("returns a minimum of 1 minute for the same place", async () => {
    const provider = new MockRoutesProvider();
    const estimate = await provider.travelMinutes(osakaCastle, osakaCastle, "walk");
    expect(estimate.minutes).toBe(1);
  });
});
