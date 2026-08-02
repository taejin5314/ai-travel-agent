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
