import { PlaceSchema, type Place } from "@/domain/schema/place";
import type { PlaceArea, PlacesPort } from "@/providers/ports";
import {
  GooglePlaceSchema,
  SearchTextResponseSchema,
  type GooglePlace,
} from "@/providers/google/schema";

const PLACES_ENDPOINT = "https://places.googleapis.com/v1";

const FIELD_MASK = [
  "id",
  "displayName",
  "location",
  "formattedAddress",
  "rating",
  "userRatingCount",
  "types",
  "primaryType",
  "regularOpeningHours",
];

/** Kansai bounding boxes; results outside both areas are dropped. */
const AREA_BOUNDS: Record<PlaceArea, { lat: [number, number]; lng: [number, number] }> = {
  osaka: { lat: [34.3, 34.85], lng: [135.25, 135.75] },
  kyoto: { lat: [34.85, 35.2], lng: [135.55, 135.95] },
};

/** Location bias covering both Osaka and Kyoto for text searches. */
const KANSAI_BIAS = {
  rectangle: {
    low: { latitude: 34.3, longitude: 135.25 },
    high: { latitude: 35.2, longitude: 135.95 },
  },
};

/**
 * A single "best restaurants" query returns a narrow, tourist-facing slice
 * (verified against live data: every meal slot filled with the same handful
 * of 4.9-rated halal spots). Cuisine-specific queries widen the pool enough
 * for the confidence-weighted ranking to have real choices. Each entry is
 * one billed request per area, cached for the process lifetime.
 */
const CATALOG_QUERIES: Record<PlaceArea, string[]> = {
  osaka: [
    "top tourist attractions in Osaka Japan",
    "popular local restaurants in Osaka Japan",
    "famous ramen restaurants in Osaka",
    "okonomiyaki and takoyaki restaurants in Osaka",
    "hotels in Osaka Japan",
  ],
  kyoto: [
    "top tourist attractions in Kyoto Japan",
    "popular local restaurants in Kyoto Japan",
    "traditional kaiseki and soba restaurants in Kyoto",
    "famous ramen restaurants in Kyoto",
    "hotels in Kyoto Japan",
  ],
};

/**
 * Last-resort duration when we know only the broad category. Eight buckets
 * over ~200 places is too coarse to be right often, which is why
 * VISIT_MINUTES_BY_TYPE below takes precedence wherever Google names the
 * place precisely.
 */
const VISIT_MINUTES_BY_CATEGORY: Record<Place["category"], number> = {
  sight: 90,
  culture: 75,
  nature: 90,
  shopping: 60,
  food: 60,
  entertainment: 180,
  restaurant: 60,
  lodging: 1,
};

/**
 * How long a visit actually takes, keyed on Google's specific type. The
 * category buckets gave 호젠지 — a shrine in a Dotonbori alley you pass
 * through in a quarter of an hour — the same 75 minutes as Osaka Castle.
 * Every wrong duration shifts every later stop of the day, so precision here
 * is worth more than it looks.
 */
const VISIT_MINUTES_BY_TYPE: Record<string, number> = {
  amusement_park: 300,
  zoo: 180,
  aquarium: 120,
  castle: 120,
  national_park: 120,
  museum: 90,
  history_museum: 90,
  art_gallery: 75,
  historical_place: 60,
  historical_landmark: 60,
  buddhist_temple: 45,
  shinto_shrine: 30,
  church: 30,
  place_of_worship: 45,
  garden: 45,
  park: 45,
  observation_deck: 45,
  market: 60,
  food_market: 60,
  shopping_mall: 75,
  department_store: 60,
  plaza: 20,
  bridge: 15,
  monument: 20,
  tourist_attraction: 60,
};

const CATEGORY_BY_TYPE: readonly [string, Place["category"]][] = [
  ["lodging", "lodging"],
  ["castle", "sight"],
  ["observation_deck", "sight"],
  ["monument", "sight"],
  ["bridge", "sight"],
  ["plaza", "sight"],
  ["hotel", "lodging"],
  ["restaurant", "restaurant"],
  ["cafe", "restaurant"],
  ["bakery", "restaurant"],
  ["amusement_park", "entertainment"],
  ["aquarium", "entertainment"],
  ["zoo", "entertainment"],
  ["movie_theater", "entertainment"],
  ["museum", "culture"],
  ["place_of_worship", "culture"],
  ["buddhist_temple", "culture"],
  ["shinto_shrine", "culture"],
  ["historical_landmark", "culture"],
  ["market", "food"],
  ["food_market", "food"],
  ["park", "nature"],
  ["garden", "nature"],
  ["national_park", "nature"],
  ["shopping_mall", "shopping"],
  ["department_store", "shopping"],
  ["tourist_attraction", "sight"],
];

type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GooglePlacesProviderOptions {
  apiKey: string;
  fetchFn?: FetchLike;
  /** Result language; Korean by default so the UI shows Korean names. */
  languageCode?: string;
}

function areaOf(lat: number, lng: number): PlaceArea | null {
  for (const [area, bounds] of Object.entries(AREA_BOUNDS) as [
    PlaceArea,
    (typeof AREA_BOUNDS)[PlaceArea],
  ][]) {
    if (
      lat >= bounds.lat[0] &&
      lat <= bounds.lat[1] &&
      lng >= bounds.lng[0] &&
      lng <= bounds.lng[1]
    ) {
      return area;
    }
  }
  return null;
}

/**
 * Types that describe every visitable place equally and therefore decide
 * nothing. Google sometimes puts one of these in `primaryType` while the
 * useful word sits in `types` — 구로몬 시장 comes back as primaryType
 * `tourist_attraction` with `market` behind it — so a generic primary type
 * must not outrank a specific secondary one.
 */
const GENERIC_TYPES = new Set([
  "tourist_attraction",
  "point_of_interest",
  "establishment",
]);

function decisive(primaryType: string | undefined): string | undefined {
  return primaryType !== undefined && !GENERIC_TYPES.has(primaryType)
    ? primaryType
    : undefined;
}

/**
 * `primaryType` is Google's own single answer to "what is this place", and it
 * wins whenever it says something specific. Reading `types` alone filed Osaka
 * Castle — primaryType `castle`, but carrying `museum` in its types soup — as
 * a museum, because `museum` sits above `tourist_attraction` in the fallback
 * order.
 */
function categoryOf(
  types: readonly string[],
  primaryType?: string,
): Place["category"] {
  const primary = decisive(primaryType);
  if (primary !== undefined) {
    const exact = CATEGORY_BY_TYPE.find(([type]) => type === primary);
    if (exact !== undefined) {
      return exact[1];
    }
  }
  for (const [googleType, category] of CATEGORY_BY_TYPE) {
    if (types.includes(googleType)) {
      return category;
    }
  }
  return "sight";
}

/**
 * Most specific signal first: the primary type, then any known type, then the
 * category bucket. A place Google describes only vaguely still gets a
 * documented default rather than nothing.
 */
function visitMinutesOf(
  types: readonly string[],
  primaryType: string | undefined,
  category: Place["category"],
): number {
  const primary = decisive(primaryType);
  if (primary !== undefined && primary in VISIT_MINUTES_BY_TYPE) {
    return VISIT_MINUTES_BY_TYPE[primary];
  }
  for (const type of types) {
    if (!GENERIC_TYPES.has(type) && type in VISIT_MINUTES_BY_TYPE) {
      return VISIT_MINUTES_BY_TYPE[type];
    }
  }
  // Only now does the catch-all get a say, so "some attraction" beats nothing.
  if (types.some((type) => type in VISIT_MINUTES_BY_TYPE)) {
    return VISIT_MINUTES_BY_TYPE.tourist_attraction;
  }
  return VISIT_MINUTES_BY_CATEGORY[category];
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Google periods (day 0 = Sunday) → our Mon..Sun tuple. One window per day;
 * overnight closes clamp to 23:59; no data at all = assume always open so
 * the validator does not reject places Google simply has no hours for.
 */
function toOpeningHours(place: GooglePlace): Place["openingHours"] {
  const periods = place.regularOpeningHours?.periods;
  const allDay = { open: "00:00", close: "23:59" };
  if (periods === undefined || periods.length === 0) {
    return [allDay, allDay, allDay, allDay, allDay, allDay, allDay];
  }
  // Google encodes "open 24 hours, every day" as ONE period starting Sunday
  // 00:00 with no close. Read literally that would mark the place closed six
  // days a week (this stranded Fushimi Inari, open 24/7, in real data).
  // Match that exact shape only: a lone open-ended period on some other day
  // is a data anomaly, not 24/7, and falls through to the per-day loop below.
  const only = periods.length === 1 ? periods[0] : undefined;
  if (
    only !== undefined &&
    only.close === undefined &&
    only.open.day === 0 &&
    only.open.hour === 0 &&
    only.open.minute === 0
  ) {
    return [allDay, allDay, allDay, allDay, allDay, allDay, allDay];
  }
  const week: (null | { open: string; close: string })[] = [
    null, null, null, null, null, null, null,
  ];
  for (const period of periods) {
    const ourIndex = (period.open.day + 6) % 7;
    if (week[ourIndex] !== null) {
      continue; // keep the first window of the day
    }
    const open = `${pad(period.open.hour)}:${pad(period.open.minute)}`;
    const close =
      period.close === undefined || period.close.day !== period.open.day
        ? "23:59"
        : `${pad(period.close.hour)}:${pad(period.close.minute)}`;
    week[ourIndex] = { open, close };
  }
  return week as Place["openingHours"];
}

export class GooglePlacesProvider implements PlacesPort {
  private readonly apiKey: string;
  private readonly fetchFn: FetchLike;
  private readonly languageCode: string;
  private readonly catalogCache = new Map<PlaceArea, Place[]>();
  private readonly placeCache = new Map<string, Place>();

  constructor(options: GooglePlacesProviderOptions) {
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? (fetch as unknown as FetchLike);
    this.languageCode = options.languageCode ?? "ko";
  }

  private toDomainPlace(googlePlace: GooglePlace): Place | null {
    const area = areaOf(
      googlePlace.location.latitude,
      googlePlace.location.longitude,
    );
    if (area === null) {
      return null; // outside Osaka/Kyoto — not supported yet
    }
    const types = googlePlace.types ?? [];
    const category = categoryOf(types, googlePlace.primaryType);
    const candidate = {
      id: googlePlace.id,
      name: googlePlace.displayName.text,
      area,
      category,
      location: {
        lat: googlePlace.location.latitude,
        lng: googlePlace.location.longitude,
      },
      openingHours: toOpeningHours(googlePlace),
      typicalVisitMinutes: visitMinutesOf(
        types,
        googlePlace.primaryType,
        category,
      ),
      rating: googlePlace.rating,
      reviewCount: googlePlace.userRatingCount,
    };
    const parsed = PlaceSchema.safeParse(candidate);
    if (!parsed.success) {
      return null; // drop entries that cannot become a valid domain Place
    }
    this.placeCache.set(parsed.data.id, parsed.data);
    return parsed.data;
  }

  private async searchText(textQuery: string): Promise<Place[]> {
    const response = await this.fetchFn(`${PLACES_ENDPOINT}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": FIELD_MASK.map((f) => `places.${f}`).join(","),
      },
      body: JSON.stringify({
        textQuery,
        languageCode: this.languageCode,
        locationBias: KANSAI_BIAS,
      }),
    });
    if (!response.ok) {
      throw new Error(`Google Places searchText failed (HTTP ${response.status})`);
    }
    const parsed = SearchTextResponseSchema.parse(await response.json());
    const places: Place[] = [];
    for (const googlePlace of parsed.places ?? []) {
      const place = this.toDomainPlace(googlePlace);
      if (place !== null) {
        places.push(place);
      }
    }
    return places;
  }

  private async catalogFor(area: PlaceArea): Promise<Place[]> {
    const cached = this.catalogCache.get(area);
    if (cached !== undefined) {
      return cached;
    }
    const results = await Promise.all(
      CATALOG_QUERIES[area].map((query) => this.searchText(query)),
    );
    const byId = new Map<string, Place>();
    for (const place of results.flat()) {
      if (place.area === area) {
        byId.set(place.id, place);
      }
    }
    const catalog = [...byId.values()];
    this.catalogCache.set(area, catalog);
    return catalog;
  }

  async listPlaces(area?: PlaceArea): Promise<Place[]> {
    if (area !== undefined) {
      return [...(await this.catalogFor(area))];
    }
    const [osaka, kyoto] = await Promise.all([
      this.catalogFor("osaka"),
      this.catalogFor("kyoto"),
    ]);
    return [...osaka, ...kyoto];
  }

  async getPlaceById(id: string): Promise<Place | null> {
    const cached = this.placeCache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const response = await this.fetchFn(
      `${PLACES_ENDPOINT}/places/${encodeURIComponent(id)}?languageCode=${this.languageCode}`,
      {
        headers: {
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": FIELD_MASK.join(","),
        },
      },
    );
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Google Places details failed (HTTP ${response.status})`);
    }
    const parsed = GooglePlaceSchema.parse(await response.json());
    return this.toDomainPlace(parsed);
  }

  async findPlacesByName(query: string): Promise<Place[]> {
    const needle = query.trim();
    if (needle.length === 0) {
      return [];
    }
    return this.searchText(needle);
  }
}
