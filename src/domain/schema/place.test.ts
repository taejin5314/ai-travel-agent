import { describe, expect, it } from "vitest";
import { PlaceSchema } from "@/domain/schema/place";

const closed = null;
const validHours = { open: "09:00", close: "17:30" };

const validPlace = {
  id: "place-1",
  name: "Osaka Castle",
  area: "osaka",
  category: "sight",
  location: { lat: 34.6873, lng: 135.5262 },
  openingHours: [closed, validHours, validHours, validHours, validHours, validHours, validHours],
  typicalVisitMinutes: 90,
};

describe("PlaceSchema", () => {
  it("accepts a valid place object", () => {
    const result = PlaceSchema.safeParse(validPlace);
    expect(result.success).toBe(true);
  });

  it("accepts a place with all days closed", () => {
    const result = PlaceSchema.safeParse({
      ...validPlace,
      openingHours: [closed, closed, closed, closed, closed, closed, closed],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bad time format", () => {
    const result = PlaceSchema.safeParse({
      ...validPlace,
      openingHours: [
        closed,
        { open: "9:00", close: "17:30" },
        validHours,
        validHours,
        validHours,
        validHours,
        validHours,
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range hour in the time string", () => {
    const result = PlaceSchema.safeParse({
      ...validPlace,
      openingHours: [
        closed,
        { open: "09:00", close: "24:30" },
        validHours,
        validHours,
        validHours,
        validHours,
        validHours,
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an openingHours array that is not exactly 7 entries", () => {
    const result = PlaceSchema.safeParse({
      ...validPlace,
      openingHours: [closed, validHours, validHours, validHours, validHours, validHours],
    });
    expect(result.success).toBe(false);
  });

  it("accepts any destination id, because the set of destinations is data", () => {
    // `area` used to be a two-value enum, which meant opening a new city
    // required a schema change. Whether an id is REGISTERED is checked at the
    // provider boundary — src/providers/google/places.test.ts proves a place
    // outside every destination is dropped rather than imported.
    const result = PlaceSchema.safeParse({ ...validPlace, area: "paris" });
    expect(result.success).toBe(true);
  });

  it("still rejects a blank area", () => {
    const result = PlaceSchema.safeParse({ ...validPlace, area: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid category enum value", () => {
    const result = PlaceSchema.safeParse({
      ...validPlace,
      category: "hotel",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range latitude", () => {
    const result = PlaceSchema.safeParse({
      ...validPlace,
      location: { lat: 95, lng: 135.5262 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range longitude", () => {
    const result = PlaceSchema.safeParse({
      ...validPlace,
      location: { lat: 34.6873, lng: -200 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty id", () => {
    const result = PlaceSchema.safeParse({
      ...validPlace,
      id: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive typicalVisitMinutes", () => {
    const result = PlaceSchema.safeParse({
      ...validPlace,
      typicalVisitMinutes: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer typicalVisitMinutes", () => {
    const result = PlaceSchema.safeParse({
      ...validPlace,
      typicalVisitMinutes: 45.5,
    });
    expect(result.success).toBe(false);
  });
});
