import { describe, expect, it } from "vitest";
import { TripPreferencesSchema } from "@/domain/schema/tripPreferences";

const validInput = {
  startDate: "2026-08-01",
  endDate: "2026-08-05",
  lodging: { name: "Hotel Osaka", area: "Namba" },
  partySize: 2,
  mustVisit: ["Osaka Castle"],
  interests: ["food"],
  pace: "balanced",
  constraints: ["no early mornings"],
};

describe("TripPreferencesSchema", () => {
  it("accepts a valid trip preferences object", () => {
    const result = TripPreferencesSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts input without optional constraints", () => {
    const withoutConstraints = {
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      lodging: { name: "Hotel Osaka", area: "Namba" },
      partySize: 2,
      mustVisit: ["Osaka Castle"],
      interests: ["food"],
      pace: "balanced",
    };
    const result = TripPreferencesSchema.safeParse(withoutConstraints);
    expect(result.success).toBe(true);
  });

  it("rejects a malformed date", () => {
    const result = TripPreferencesSchema.safeParse({
      ...validInput,
      startDate: "08/01/2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer partySize", () => {
    const result = TripPreferencesSchema.safeParse({
      ...validInput,
      partySize: 2.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects partySize below 1", () => {
    const result = TripPreferencesSchema.safeParse({
      ...validInput,
      partySize: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty string in mustVisit", () => {
    const result = TripPreferencesSchema.safeParse({
      ...validInput,
      mustVisit: [""],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid pace value", () => {
    const result = TripPreferencesSchema.safeParse({
      ...validInput,
      pace: "chill",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only lodging name", () => {
    const result = TripPreferencesSchema.safeParse({
      ...validInput,
      lodging: { ...validInput.lodging, name: "   " },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only lodging area", () => {
    const result = TripPreferencesSchema.safeParse({
      ...validInput,
      lodging: { ...validInput.lodging, area: "   " },
    });
    expect(result.success).toBe(false);
  });
});
