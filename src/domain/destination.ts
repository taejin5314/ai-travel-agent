import { z } from "zod";
import destinationsFixture from "../../fixtures/destinations.json";

/**
 * A place a trip can go to.
 *
 * Data, not code. The app used to hard-code `"osaka" | "kyoto"` as an enum,
 * bounding boxes as constants, and catalog queries as hand-written English
 * sentences with the city name baked in — so serving anywhere else meant
 * editing four files, and coordinates outside Kansai were silently discarded.
 * Opening a new destination is now an entry in `fixtures/destinations.json`.
 */
/**
 * A kind of food worth offering in one destination.
 *
 * Per destination rather than a global enum: the enum was written when the
 * app served only Kansai, so a Paris traveller was offered 오코노미야키 and
 * the search ran "okonomiyaki restaurants in Paris, France". What is worth
 * eating is a property of the place, so it lives with the place.
 *
 * Every entry still has to change what the planner does (the §32 rule) —
 * `query` is a real catalog search, not a label.
 */
export const DestinationCuisineSchema = z.object({
  /** Stable id; shared ids across destinations are fine and intended ("cafe"). */
  id: z.string().min(1),
  label: z.string().min(1),
  /** Search phrase; `{city}` is replaced with the destination's searchName. */
  query: z.string().min(1),
});

export type DestinationCuisine = z.infer<typeof DestinationCuisineSchema>;

export const DestinationSchema = z.object({
  /** Stable id; appears in saved plans, so it must not be renamed casually. */
  id: z.string().min(1),
  /** Shown to the traveller, in their language. */
  name: z.string().min(1),
  /**
   * Used to build catalog search phrases. English, because that is what the
   * Places text search is most consistent with, and it includes the country
   * so "Naples" does not return Florida.
   */
  searchName: z.string().min(1),
  /** ISO 3166-1 alpha-2, for grouping and for coverage reporting. */
  country: z.string().length(2),
  /** What is worth eating here, in display order. */
  cuisines: z.array(DestinationCuisineSchema).default([]),
  /** Results outside this box are not part of this destination. */
  bounds: z.object({
    lat: z.tuple([z.number().min(-90).max(90), z.number().min(-90).max(90)]),
    lng: z.tuple([z.number().min(-180).max(180), z.number().min(-180).max(180)]),
  }),
});

export type Destination = z.infer<typeof DestinationSchema>;
/** A destination id. Not an enum — the set is data and grows without code. */
export type DestinationId = string;

const DESTINATIONS: Destination[] = DestinationSchema.array()
  .refine(
    (list) => new Set(list.map((entry) => entry.id)).size === list.length,
    { message: "destination ids must be unique" },
  )
  .parse(destinationsFixture);

const BY_ID = new Map(DESTINATIONS.map((entry) => [entry.id, entry]));

export function allDestinations(): readonly Destination[] {
  return DESTINATIONS;
}

export function findDestination(id: DestinationId): Destination | undefined {
  return BY_ID.get(id);
}

/**
 * Which destination a coordinate belongs to, or undefined when it belongs to
 * none of them. Order is registry order, so overlapping boxes resolve
 * predictably rather than by whichever happened to be checked first.
 */
export function destinationAt(
  lat: number,
  lng: number,
): Destination | undefined {
  return DESTINATIONS.find(
    (entry) =>
      lat >= entry.bounds.lat[0] &&
      lat <= entry.bounds.lat[1] &&
      lng >= entry.bounds.lng[0] &&
      lng <= entry.bounds.lng[1],
  );
}

/**
 * The cuisines on offer for a set of destinations, de-duplicated by id and
 * in registry order. A traveller doing Osaka and Kyoto sees 라멘 once, not
 * twice; the per-destination query still runs separately for each.
 */
export function cuisineOptionsFor(
  ids: readonly DestinationId[],
): DestinationCuisine[] {
  const byId = new Map<string, DestinationCuisine>();
  for (const id of ids) {
    for (const cuisine of findDestination(id)?.cuisines ?? []) {
      if (!byId.has(cuisine.id)) {
        byId.set(cuisine.id, cuisine);
      }
    }
  }
  return [...byId.values()];
}

/** The search phrase for one cuisine in one destination, if it offers it. */
export function cuisineQueryFor(
  destinationId: DestinationId,
  cuisineId: string,
): string | undefined {
  const destination = findDestination(destinationId);
  const cuisine = destination?.cuisines.find((entry) => entry.id === cuisineId);
  return cuisine === undefined
    ? undefined
    : cuisine.query.replace("{city}", destination!.searchName);
}

/** The box covering every destination, for biasing a text search. */
export function registryBounds(): {
  lat: [number, number];
  lng: [number, number];
} {
  const lats = DESTINATIONS.flatMap((entry) => entry.bounds.lat);
  const lngs = DESTINATIONS.flatMap((entry) => entry.bounds.lng);
  return {
    lat: [Math.min(...lats), Math.max(...lats)],
    lng: [Math.min(...lngs), Math.max(...lngs)],
  };
}
