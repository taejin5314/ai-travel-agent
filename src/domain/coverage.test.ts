import { describe, expect, it } from "vitest";
import {
  coverageCheckedAt,
  hasMeasuredTransit,
  serviceableDestinations,
} from "@/domain/coverage";
import { allDestinations } from "@/domain/destination";

describe("coverage", () => {
  it("only offers destinations the probe found serviceable", () => {
    const offered = serviceableDestinations().map((d) => d.id);
    expect(offered.length).toBeGreaterThan(0);
    for (const id of offered) {
      expect(allDestinations().some((d) => d.id === id)).toBe(true);
    }
  });

  it("excludes a registered destination that was never probed", () => {
    // Unmeasured is not the same as working. Offering an unprobed city would
    // be exactly the guess this mechanism exists to remove.
    const offered = new Set(serviceableDestinations().map((d) => d.id));
    for (const destination of allDestinations()) {
      if (!offered.has(destination.id)) {
        expect(hasMeasuredTransit(destination.id)).toBe(false);
      }
    }
  });

  it("reports measured transit separately from serviceability", () => {
    // The whole point of AGENTS.md §6b: Osaka ships without measured
    // transit. If this ever flips to true, Google started serving Japan and
    // the estimate labelling can be revisited.
    const osaka = serviceableDestinations().find((d) => d.id === "osaka");
    expect(osaka).toBeDefined();
    expect(hasMeasuredTransit("osaka")).toBe(false);
  });

  it("carries the date it was measured, so staleness is visible", () => {
    expect(Number.isNaN(Date.parse(coverageCheckedAt()))).toBe(false);
  });

  it("says nothing about a destination it has never heard of", () => {
    expect(hasMeasuredTransit("atlantis")).toBe(false);
  });
});
