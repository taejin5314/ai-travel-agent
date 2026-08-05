import type { Activity } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
import { timeToMinutes } from "@/validators/itinerary";

/**
 * Spreads a short day across its hours instead of packing it into the morning.
 *
 * A relaxed day visits two places — correct, since going slowly means seeing
 * less — but the planner schedules everything as early as it will fit, so
 * sightseeing finished at 11:07 and the traveller then waited 269 minutes for
 * dinner. The stop count was right; the placement was not.
 *
 * This moves start times only. Nothing is added, removed or reordered, and a
 * stop that cannot move without leaving its opening hours simply does not.
 */

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The latest each stop could start without pushing the one after it, walking
 * backwards from the last. The final stop never moves: it is usually dinner,
 * anchored to its window, and shifting it would trade one problem for another.
 */
function latestStarts(
  activities: readonly Activity[],
  placeById: ReadonlyMap<string, Place>,
  dayOfWeek: number,
): number[] {
  const latest: number[] = new Array(activities.length).fill(0);
  for (let i = activities.length - 1; i >= 0; i -= 1) {
    const activity = activities[i];
    const start = timeToMinutes(activity.start);
    const duration = timeToMinutes(activity.end) - start;
    if (i === activities.length - 1) {
      latest[i] = start;
      continue;
    }
    const window = placeById.get(activity.placeId)?.openingHours[dayOfWeek];
    const closes = window === null || window === undefined
      ? Number.POSITIVE_INFINITY
      : timeToMinutes(window.close);
    const nextTravel = activities[i + 1].travel?.minutes ?? 0;
    latest[i] = Math.min(
      closes - duration,
      latest[i + 1] - nextTravel - duration,
    );
  }
  return latest;
}

/**
 * Same stops, same order, later starts where there is room.
 *
 * Slack is handed out in proportion to how far through the day a stop is, so
 * the free time ends up between stops rather than pooled in one dead block
 * before dinner. Whether a traveller prefers one long break or several short
 * ones is a real question — this does not eliminate gaps, it stops any single
 * one swallowing the afternoon.
 */
export function spreadDay(
  activities: readonly Activity[],
  placeById: ReadonlyMap<string, Place>,
  dayOfWeek: number,
): Activity[] {
  if (activities.length < 3) {
    // Two stops and a gap between them is already spread; there is nothing to
    // redistribute that would not just move the same hole elsewhere.
    return [...activities];
  }
  const latest = latestStarts(activities, placeById, dayOfWeek);
  const totalSlack = Math.max(0, latest[0] - timeToMinutes(activities[0].start));
  if (totalSlack === 0) {
    return [...activities];
  }

  const spread: Activity[] = [];
  let previousEnd = -Infinity;
  for (const [index, activity] of activities.entries()) {
    const earliest = timeToMinutes(activity.start);
    const duration = timeToMinutes(activity.end) - earliest;
    const share = Math.round((totalSlack * index) / activities.length);
    const travel = activity.travel?.minutes ?? 0;
    const start = Math.max(
      earliest,
      // Never overlap the stop before, whatever the share suggests.
      previousEnd + travel,
      Math.min(earliest + share, latest[index]),
    );
    previousEnd = start + duration;
    spread.push({
      ...activity,
      start: minutesToTime(start),
      end: minutesToTime(previousEnd),
    });
  }
  return spread;
}
