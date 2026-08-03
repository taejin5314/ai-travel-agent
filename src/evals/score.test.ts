import { describe, expect, it } from "vitest";
import type { Itinerary } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import { scoreItinerary } from "@/evals/score";

const open = { open: "09:00", close: "22:00" };

function place(overrides: Partial<Place> & Pick<Place, "id">): Place {
  return {
    name: overrides.id,
    area: "osaka",
    category: "sight",
    location: { lat: 34.67, lng: 135.5 },
    openingHours: [open, open, open, open, open, open, open],
    typicalVisitMinutes: 60,
    ...overrides,
  };
}

const places: Place[] = [
  place({ id: "castle", name: "Osaka Castle", aliases: ["오사카성"] }),
  place({ id: "inari", name: "Fushimi Inari", area: "kyoto" }),
  place({ id: "ramen", name: "Ichiran", category: "restaurant" }),
];

// 2026-10-06 is a Tuesday.
const preferences: TripPreferences = {
  startDate: "2026-10-06",
  endDate: "2026-10-06",
  lodging: { name: "Hotel", area: "Namba" },
  partySize: 2,
  mustVisit: ["오사카성"],
  interests: [],
  pace: "balanced",
};

function itineraryOf(activities: Itinerary["days"][number]["activities"]): Itinerary {
  return { days: [{ date: "2026-10-06", activities }] };
}

describe("scoreItinerary", () => {
  it("credits a must-visit matched through its Korean alias", () => {
    const score = scoreItinerary(
      itineraryOf([{ placeId: "castle", start: "09:30", end: "10:30" }]),
      places,
      preferences,
    );
    expect(score.mustVisitCoverage).toBe(1);
  });

  it("reports partial coverage when a must-visit is missing", () => {
    const score = scoreItinerary(
      itineraryOf([{ placeId: "inari", start: "09:30", end: "10:30" }]),
      places,
      { ...preferences, mustVisit: ["오사카성", "Fushimi"] },
    );
    expect(score.mustVisitCoverage).toBe(0.5);
  });

  it("scores full coverage when nothing was requested", () => {
    const score = scoreItinerary(
      itineraryOf([{ placeId: "castle", start: "09:30", end: "10:30" }]),
      places,
      { ...preferences, mustVisit: [] },
    );
    expect(score.mustVisitCoverage).toBe(1);
  });

  it("counts a hop between areas", () => {
    const score = scoreItinerary(
      itineraryOf([
        { placeId: "castle", start: "09:30", end: "10:30" },
        {
          placeId: "inari",
          start: "11:10",
          end: "12:10",
          travel: { minutes: 40, mode: "transit" },
        },
      ]),
      places,
      preferences,
    );
    expect(score.crossAreaHops).toBe(1);
    // The whole gap is the train ride, so nothing is idle.
    expect(score.idleMinutes).toBe(0);
  });

  it("counts only the waiting time the travel leg does not explain", () => {
    const score = scoreItinerary(
      itineraryOf([
        { placeId: "castle", start: "09:30", end: "10:30" },
        {
          placeId: "inari",
          start: "12:00",
          end: "13:00",
          travel: { minutes: 40, mode: "transit" },
        },
      ]),
      places,
      preferences,
    );
    // 90 minutes between stops, 40 of them travelling.
    expect(score.idleMinutes).toBe(50);
  });

  it("credits coverage only to the place the planner would have resolved", () => {
    // "Castle" loosely matches both; the planner takes the first catalog hit,
    // so scheduling the other one is a miss, not a pass.
    const catalog = [
      ...places,
      place({ id: "nijo", name: "Nijo Castle", area: "kyoto" }),
    ];
    const score = scoreItinerary(
      itineraryOf([{ placeId: "nijo", start: "09:30", end: "10:30" }]),
      catalog,
      { ...preferences, mustVisit: ["Castle"] },
    );
    expect(score.mustVisitCoverage).toBe(0);
  });

  it("counts a meal slot once even when two restaurants land in the same window", () => {
    // Regression: a raw restaurant count reported this as both slots filled,
    // which hid a day whose lunch was pushed into the dinner window.
    const score = scoreItinerary(
      itineraryOf([
        { placeId: "ramen", start: "18:00", end: "18:45" },
        { placeId: "ramen", start: "18:45", end: "19:30" },
      ]),
      places,
      preferences,
    );
    expect(score.mealSlotsFilled).toBe(1);
    expect(score.mealSlotsExpected).toBe(2);
  });

  it("ignores a restaurant outside both meal windows", () => {
    const score = scoreItinerary(
      itineraryOf([{ placeId: "ramen", start: "08:00", end: "08:45" }]),
      places,
      preferences,
    );
    expect(score.mealSlotsFilled).toBe(0);
  });

  it("expects meals for every requested day, not just the planned ones", () => {
    // A planner that silently drops a day must not shrink its own target.
    const score = scoreItinerary(
      itineraryOf([{ placeId: "ramen", start: "12:00", end: "12:45" }]),
      places,
      { ...preferences, endDate: "2026-10-08" },
    );
    expect(score.days).toBe(1);
    expect(score.mealSlotsExpected).toBe(6);
    expect(score.mealSlotsFilled).toBe(1);
  });

  it("counts restaurants as filled meal slots against two per day", () => {
    const score = scoreItinerary(
      itineraryOf([
        { placeId: "castle", start: "09:30", end: "10:30" },
        { placeId: "ramen", start: "12:00", end: "12:45" },
      ]),
      places,
      preferences,
    );
    expect(score.mealSlotsFilled).toBe(1);
    expect(score.mealSlotsExpected).toBe(2);
    expect(score.activities).toBe(2);
    expect(score.days).toBe(1);
  });

  it("totals walking minutes and remembers the worst single walk", () => {
    // A trip is judged by its worst hop: three gentle strolls and one
    // hour-long trek must not average out into something acceptable.
    const score = scoreItinerary(
      itineraryOf([
        { placeId: "castle", start: "09:30", end: "10:30" },
        {
          placeId: "inari",
          start: "10:42",
          end: "11:42",
          travel: { minutes: 12, mode: "walk" },
        },
        {
          placeId: "ramen",
          start: "12:00",
          end: "12:45",
          travel: { minutes: 18, mode: "walk" },
        },
      ]),
      places,
      preferences,
    );
    expect(score.walkingMinutes).toBe(30);
    expect(score.longestWalkMinutes).toBe(18);
  });

  it("does not count transit legs as walking", () => {
    const score = scoreItinerary(
      itineraryOf([
        { placeId: "castle", start: "09:30", end: "10:30" },
        {
          placeId: "inari",
          start: "11:20",
          end: "12:20",
          travel: { minutes: 50, mode: "transit", estimated: true },
        },
      ]),
      places,
      preferences,
    );
    expect(score.walkingMinutes).toBe(0);
    expect(score.longestWalkMinutes).toBe(0);
  });

  it("counts how many legs nobody measured", () => {
    const score = scoreItinerary(
      itineraryOf([
        { placeId: "castle", start: "09:30", end: "10:30" },
        {
          placeId: "inari",
          start: "10:45",
          end: "11:45",
          travel: { minutes: 15, mode: "transit", estimated: true },
        },
        {
          placeId: "ramen",
          start: "12:00",
          end: "12:45",
          travel: { minutes: 10, mode: "walk" },
        },
      ]),
      places,
      preferences,
    );
    expect(score.estimatedLegs).toBe(1);
  });

  it("reports a structural violation the validator catches", () => {
    const score = scoreItinerary(
      itineraryOf([
        { placeId: "castle", start: "09:30", end: "11:00" },
        { placeId: "inari", start: "10:00", end: "11:00" },
      ]),
      places,
      preferences,
    );
    expect(score.validatorPassed).toBe(false);
    expect(score.validatorErrors.length).toBeGreaterThan(0);
  });

  it("does not let a missing must-visit fail the structural check", () => {
    // Coverage is its own metric; the two signals must stay independent so a
    // regression in one is readable on its own.
    const score = scoreItinerary(
      itineraryOf([{ placeId: "inari", start: "09:30", end: "10:30" }]),
      places,
      preferences,
    );
    expect(score.mustVisitCoverage).toBe(0);
    expect(score.validatorPassed).toBe(true);
  });
});
