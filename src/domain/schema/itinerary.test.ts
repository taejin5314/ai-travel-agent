import { describe, expect, it } from "vitest";
import { ActivitySchema, DayPlanSchema, ItinerarySchema } from "@/domain/schema/itinerary";

const validActivity = {
  placeId: "place-1",
  start: "09:00",
  end: "10:30",
  note: "Arrive early to avoid crowds",
};

const validDayPlan = {
  date: "2026-08-01",
  activities: [validActivity],
};

describe("ActivitySchema", () => {
  it("accepts a valid activity", () => {
    const result = ActivitySchema.safeParse(validActivity);
    expect(result.success).toBe(true);
  });

  it("accepts an activity without an optional note", () => {
    const withoutNote = {
      placeId: validActivity.placeId,
      start: validActivity.start,
      end: validActivity.end,
    };
    const result = ActivitySchema.safeParse(withoutNote);
    expect(result.success).toBe(true);
  });

  it("accepts an optional travel leg", () => {
    const result = ActivitySchema.safeParse({
      ...validActivity,
      travel: { minutes: 24, mode: "transit" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a leg flagged as estimated", () => {
    const result = ActivitySchema.safeParse({
      ...validActivity,
      travel: { minutes: 136, mode: "transit", estimated: true },
    });
    expect(result.success).toBe(true);
  });

  it("rejects estimated: false rather than storing a redundant flag", () => {
    // Absent means measured. Allowing both spellings would let two records
    // say the same thing differently and make saved plans harder to compare.
    const result = ActivitySchema.safeParse({
      ...validActivity,
      travel: { minutes: 20, mode: "transit", estimated: false },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a travel leg of zero minutes", () => {
    // "No travel" is expressed by omitting the leg, never by storing 0.
    const result = ActivitySchema.safeParse({
      ...validActivity,
      travel: { minutes: 0, mode: "walk" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative or fractional travel minutes", () => {
    for (const minutes of [-5, 12.5]) {
      const result = ActivitySchema.safeParse({
        ...validActivity,
        travel: { minutes, mode: "walk" },
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects an unknown travel mode", () => {
    const result = ActivitySchema.safeParse({
      ...validActivity,
      travel: { minutes: 10, mode: "taxi" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bad time format for start", () => {
    const result = ActivitySchema.safeParse({ ...validActivity, start: "9am" });
    expect(result.success).toBe(false);
  });

  it("rejects a bad time format for end", () => {
    const result = ActivitySchema.safeParse({ ...validActivity, end: "25:00" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty placeId", () => {
    const result = ActivitySchema.safeParse({ ...validActivity, placeId: "" });
    expect(result.success).toBe(false);
  });
});

describe("DayPlanSchema", () => {
  it("accepts a valid day plan", () => {
    const result = DayPlanSchema.safeParse(validDayPlan);
    expect(result.success).toBe(true);
  });

  it("accepts a day plan with no activities", () => {
    const result = DayPlanSchema.safeParse({ date: "2026-08-01", activities: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed date", () => {
    const result = DayPlanSchema.safeParse({ ...validDayPlan, date: "08/01/2026" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid activity within the day plan", () => {
    const result = DayPlanSchema.safeParse({
      date: "2026-08-01",
      activities: [{ ...validActivity, start: "bad-time" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("ItinerarySchema", () => {
  it("accepts a valid itinerary", () => {
    const result = ItinerarySchema.safeParse({ days: [validDayPlan] });
    expect(result.success).toBe(true);
  });

  it("rejects an itinerary with empty days", () => {
    const result = ItinerarySchema.safeParse({ days: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an itinerary with an invalid day plan", () => {
    const result = ItinerarySchema.safeParse({
      days: [{ ...validDayPlan, date: "not-a-date" }],
    });
    expect(result.success).toBe(false);
  });
});
