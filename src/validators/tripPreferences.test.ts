import { describe, expect, it } from "vitest";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import {
  MAX_PARTY_SIZE,
  MAX_TRIP_LENGTH_DAYS,
  validateTripPreferences,
} from "@/validators/tripPreferences";

const basePreferences: TripPreferences = {
  startDate: "2026-08-01",
  endDate: "2026-08-05",
  lodging: { name: "Hotel Osaka", area: "Namba" },
  destinations: ["osaka", "kyoto"],
  partySize: 2,
  mustVisit: ["Osaka Castle", "Dotonbori"],
  interests: ["food"],
  pace: "balanced",
};

describe("validateTripPreferences", () => {
  it("passes for valid trip preferences", () => {
    const result = validateTripPreferences(basePreferences);
    expect(result).toEqual({ ok: true });
  });

  it("fails when endDate is before startDate", () => {
    const result = validateTripPreferences({
      ...basePreferences,
      startDate: "2026-08-05",
      endDate: "2026-08-01",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("startDate"))).toBe(true);
    }
  });

  it("passes when endDate equals startDate (single-day trip)", () => {
    const result = validateTripPreferences({
      ...basePreferences,
      startDate: "2026-08-01",
      endDate: "2026-08-01",
    });
    expect(result).toEqual({ ok: true });
  });

  it("fails when trip length exceeds the maximum", () => {
    const result = validateTripPreferences({
      ...basePreferences,
      startDate: "2026-01-01",
      endDate: "2026-02-15",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.includes(String(MAX_TRIP_LENGTH_DAYS))),
      ).toBe(true);
    }
  });

  it("fails for duplicate mustVisit entries (case-insensitive, trimmed)", () => {
    const result = validateTripPreferences({
      ...basePreferences,
      mustVisit: ["Osaka Castle", " osaka castle "],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
    }
  });

  it("fails when partySize is out of range", () => {
    const result = validateTripPreferences({
      ...basePreferences,
      partySize: MAX_PARTY_SIZE + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("partySize"))).toBe(true);
    }
  });
});

describe("validateTripPreferences destinations", () => {
  const base = {
    startDate: "2026-10-06",
    endDate: "2026-10-07",
    lodging: { name: "Hotel", area: "Namba" },
    partySize: 2,
    mustVisit: [],
    interests: [],
    pace: "balanced" as const,
  };

  it("accepts a destination the probe found serviceable", () => {
    expect(
      validateTripPreferences({ ...base, destinations: ["osaka"] }),
    ).toEqual({ ok: true });
  });

  it("rejects a destination we have never probed", () => {
    // The form cannot offer one, but a hand-crafted POST can ask for one, and
    // it would otherwise plan against an empty catalog and fail obscurely.
    const result = validateTripPreferences({
      ...base,
      destinations: ["atlantis"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("atlantis"))).toBe(true);
    }
  });
});
