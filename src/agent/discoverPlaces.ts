import { ratingScore } from "@/agent/planTrip";
import type { Place } from "@/domain/schema/place";
import type { PlacesPort } from "@/providers/ports";

/**
 * Candidates worth showing for a set of destinations.
 *
 * Attractions and restaurants stay apart because they are chosen for
 * different reasons — one fills a day, the other fills a meal slot — and a
 * single ranked list would bury every restaurant under the famous sights.
 */
export type Discovery = {
  attractions: Place[];
  restaurants: Place[];
  /**
   * Somewhere to sleep. Its own list because it is chosen once for the whole
   * trip, not per day — and because typing a lodging name is what resolved a
   * Seoul trip to a hotel in Kyoto.
   */
  lodging: Place[];
};

export type DiscoverOptions = {
  /** Cuisine ids; widens the restaurant pool, never narrows it. */
  cuisines?: readonly string[];
  /** Cap per list, so the map is not flooded. */
  limit?: number;
};

const DEFAULT_LIMIT = 30;

/**
 * What is worth seeing in these destinations, ranked, planning nothing.
 *
 * No dates, no opening hours, no travel: this answers "what is here", and
 * `planTrip` answers "when do we go". Keeping them apart is what lets the
 * traveller choose the places themselves — the app's weakest guess today is
 * inferring taste from interests and ratings, and a chosen set removes it.
 */
export async function discoverPlaces(
  places: PlacesPort,
  destinations: readonly string[],
  options: DiscoverOptions = {},
): Promise<Discovery> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const cuisines = options.cuisines ?? [];

  // Only what was asked for. Fetching the whole registry is what would have
  // put Paris in an Osaka trip before destinations became explicit.
  const catalogs = await Promise.all(
    destinations.map((destination) => places.listPlaces(destination)),
  );
  // Cuisine matches join the pool rather than filter it: a catalog built from
  // generic queries may contain no bistro at all, so filtering would leave
  // nothing to show.
  const cuisineMatches =
    cuisines.length > 0
      ? (
          await Promise.all(
            destinations.map((destination) =>
              places.findRestaurants(cuisines, destination),
            ),
          )
        ).flat()
      : [];

  const byId = new Map<string, Place>();
  for (const place of [...catalogs.flat(), ...cuisineMatches]) {
    byId.set(place.id, place);
  }
  const unique = [...byId.values()];
  const requested = new Set(cuisineMatches.map((place) => place.id));

  /**
   * Requested cuisines rank above everything else, then rating decides.
   *
   * Merging them into one rating-ordered pool was not enough: asking Paris
   * for bistros returned a list identical to asking for nothing, because the
   * famous brasseries outscore them and the cap cut the bistros off. On a
   * screen built for choosing, a request that changes nothing visible is a
   * request that was ignored.
   */
  const ranked = (candidates: Place[]) =>
    candidates
      .sort(
        (a, b) =>
          Number(requested.has(b.id)) - Number(requested.has(a.id)) ||
          ratingScore(b) - ratingScore(a),
      )
      .slice(0, limit);

  return {
    // Lodging is offered separately, never mixed into the day is stops.
    attractions: ranked(
      unique.filter(
        (place) => place.category !== "restaurant" && place.category !== "lodging",
      ),
    ),
    restaurants: ranked(
      unique.filter((place) => place.category === "restaurant"),
    ),
    lodging: ranked(unique.filter((place) => place.category === "lodging")),
  };
}
