import { describe, expect, it } from "vitest";
import { spreadDay } from "@/agent/spreadDay";
import type { Activity } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
import { timeToMinutes } from "@/validators/itinerary";

function place(id: string, close = "22:00"): Place {
  const window = { open: "09:00", close };
  return {
    id,
    name: id,
    area: "osaka",
    category: "sight",
    location: { lat: 34.67, lng: 135.5 },
    openingHours: [window, window, window, window, window, window, window],
    typicalVisitMinutes: 60,
  };
}

function activity(placeId: string, start: string, end: string, travel = 0): Activity {
  return {
    placeId,
    start,
    end,
    ...(travel > 0 && { travel: { minutes: travel, mode: "transit" as const } }),
  };
}

/** The longest wait not explained by the travel leg that follows it. */
function longestGap(activities: readonly Activity[]): number {
  let worst = 0;
  for (let i = 1; i < activities.length; i += 1) {
    const gap =
      timeToMinutes(activities[i].start) -
      timeToMinutes(activities[i - 1].end) -
      (activities[i].travel?.minutes ?? 0);
    worst = Math.max(worst, gap);
  }
  return worst;
}

const places = new Map([
  ["a", place("a")],
  ["b", place("b")],
  ["c", place("c")],
  ["dinner", place("dinner")],
]);

describe("spreadDay", () => {
  it("breaks up an afternoon that swallowed the day", () => {
    // The reported shape: sightseeing over by 11:07, then 269 minutes of
    // nothing before dinner.
    const frontLoaded = [
      activity("a", "09:47", "10:32"),
      activity("b", "10:47", "11:07", 15),
      activity("c", "12:00", "12:45", 10),
      activity("dinner", "17:30", "18:30", 20),
    ];
    const spread = spreadDay(frontLoaded, places, 1);
    expect(longestGap(spread)).toBeLessThan(longestGap(frontLoaded) / 2);
  });

  it("keeps the same stops in the same order", () => {
    const day = [
      activity("a", "09:47", "10:32"),
      activity("b", "10:47", "11:07", 15),
      activity("c", "12:00", "12:45", 10),
      activity("dinner", "17:30", "18:30", 20),
    ];
    const spread = spreadDay(day, places, 1);
    expect(spread.map((a) => a.placeId)).toEqual(day.map((a) => a.placeId));
  });

  it("leaves the last stop where it was", () => {
    // Usually dinner, anchored to its window. Moving it would trade one
    // problem for another.
    const day = [
      activity("a", "09:47", "10:32"),
      activity("b", "10:47", "11:07", 15),
      activity("dinner", "17:30", "18:30", 20),
    ];
    const spread = spreadDay(day, places, 1);
    expect(spread.at(-1)?.start).toBe("17:30");
  });

  it("never pushes a stop past its closing time", () => {
    const closesEarly = new Map(places);
    closesEarly.set("b", place("b", "12:00"));
    const day = [
      activity("a", "09:00", "10:00"),
      activity("b", "10:10", "11:10", 10),
      activity("dinner", "17:30", "18:30", 20),
    ];
    const spread = spreadDay(day, closesEarly, 1);
    expect(timeToMinutes(spread[1].end)).toBeLessThanOrEqual(
      timeToMinutes("12:00"),
    );
  });

  it("never overlaps two stops", () => {
    const day = [
      activity("a", "09:00", "10:00"),
      activity("b", "10:10", "11:10", 10),
      activity("c", "11:20", "12:20", 10),
      activity("dinner", "17:30", "18:30", 20),
    ];
    const spread = spreadDay(day, places, 1);
    for (let i = 1; i < spread.length; i += 1) {
      const gap =
        timeToMinutes(spread[i].start) - timeToMinutes(spread[i - 1].end);
      expect(gap).toBeGreaterThanOrEqual(spread[i].travel?.minutes ?? 0);
    }
  });

  it("leaves a day with no room to move alone", () => {
    const packed = [
      activity("a", "09:00", "10:00"),
      activity("b", "10:00", "11:00"),
      activity("dinner", "11:00", "12:00"),
    ];
    expect(spreadDay(packed, places, 1)).toEqual(packed);
  });

  it("passes through a day too short to redistribute", () => {
    // Two stops and a gap is already spread; moving one only relocates the
    // same hole.
    const two = [activity("a", "09:00", "10:00"), activity("dinner", "17:30", "18:30")];
    expect(spreadDay(two, places, 1)).toEqual(two);
    expect(spreadDay([], places, 1)).toEqual([]);
  });

  it("is deterministic", () => {
    const day = [
      activity("a", "09:47", "10:32"),
      activity("b", "10:47", "11:07", 15),
      activity("dinner", "17:30", "18:30", 20),
    ];
    expect(spreadDay(day, places, 1)).toEqual(spreadDay(day, places, 1));
  });
});
