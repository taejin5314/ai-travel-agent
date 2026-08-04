import type { ZodError } from "zod";
import {
  hasMeasuredTransit,
  serviceableDestinations,
} from "@/domain/coverage";
import { cuisineOptionsFor } from "@/domain/destination";
import type { TripConstraint } from "@/domain/schema/constraint";
import type { Itinerary } from "@/domain/schema/itinerary";
import { estimateCost, type CostEstimate } from "@/domain/cost";
import type { Place } from "@/domain/schema/place";
import type { TravelLeg } from "@/domain/schema/travel";
import type { TripPreferences } from "@/domain/schema/tripPreferences";
import { directionsUrl, placeUrl } from "@/lib/googleMaps";

// Mirrors the bounds enforced by validateTripPreferences (src/validators/tripPreferences.ts).
// Kept as literals so this shared client/server module never imports from validators/.
const MIN_PARTY_SIZE = 1;
const MAX_PARTY_SIZE = 20;
const MAX_TRIP_LENGTH_DAYS = 30;

/** Raw (untrimmed-safe) field strings, used to re-populate the form after a failed submission. */
export type PlanFormValues = {
  startDate: string;
  endDate: string;
  lodgingName: string;
  lodgingArea: string;
  partySize: string;
  mustVisit: string;
  interests: string;
  pace: string;
  /** Checked destination ids, kept raw so the form can restore them. */
  destinations: string[];
  /** Checked cuisine values, kept raw so the form can restore them. */
  cuisines: string[];
  /** Checked constraint values, kept raw so the form can restore them. */
  constraints: string[];
};

/**
 * The constraint checkboxes the form offers, in display order. Every option
 * here is honoured by the planner — nothing is shown that only decorates the
 * summary.
 */
export const CONSTRAINT_OPTIONS: readonly {
  value: TripConstraint;
  label: string;
  hint: string;
}[] = [
  {
    value: "late-start",
    label: "늦게 시작",
    hint: "오전 11시부터 일정을 시작합니다",
  },
  {
    value: "early-end",
    label: "일찍 마무리",
    hint: "관광 일정을 오후 4시 30분에 마칩니다 (식사는 그대로)",
  },
  {
    value: "less-walking",
    label: "걷기 최소화",
    hint: "걸어갈 만한 거리도 대중교통을 이용합니다",
  },
];

/**
 * Only destinations the probe found serviceable, so the form cannot offer a
 * city that would plan against an empty catalog. Whether travel times there
 * are measured or estimated is shown, not used to hide the option
 * (AGENTS.md §6b).
 */
export const DESTINATION_OPTIONS: readonly {
  value: string;
  label: string;
  transitMeasured: boolean;
}[] = serviceableDestinations().map((destination) => ({
  value: destination.id,
  label: destination.name,
  transitMeasured: hasMeasuredTransit(destination.id),
}));

const DESTINATION_LABELS = new Map(
  DESTINATION_OPTIONS.map((option) => [option.value, option.label]),
);

export function destinationLabel(id: string): string {
  return DESTINATION_LABELS.get(id) ?? id;
}

/**
 * The cuisines on offer for the destinations currently chosen. Empty until
 * one is chosen, because "what is worth eating" has no answer before then.
 */
export function cuisineOptions(
  destinationIds: readonly string[],
): { value: string; label: string }[] {
  return cuisineOptionsFor(destinationIds).map((cuisine) => ({
    value: cuisine.id,
    label: cuisine.label,
  }));
}

const ALL_CUISINE_LABELS = new Map(
  cuisineOptionsFor(serviceableDestinations().map((d) => d.id)).map((c) => [
    c.id,
    c.label,
  ]),
);

export function cuisineLabel(cuisine: string): string {
  return ALL_CUISINE_LABELS.get(cuisine) ?? cuisine;
}

const CONSTRAINT_LABELS = new Map(
  CONSTRAINT_OPTIONS.map((option) => [option.value, option.label]),
);

export function constraintLabel(constraint: TripConstraint): string {
  return CONSTRAINT_LABELS.get(constraint) ?? constraint;
}

/** Presentation-only view of a generated itinerary (place ids resolved to names). */
export type ItineraryViewDay = {
  date: string;
  /** Meal cost for this day, or absent when nothing on it had a price. */
  cost?: CostEstimate;
  items: {
    placeName: string;
    start: string;
    end: string;
    kind: "visit" | "meal";
    rating?: number;
    /** Hop taken to reach this stop; absent on the first stop of a day. */
    travel?: TravelLeg;
    /** The stop on Google Maps. */
    placeUrl: string;
    /** Where the stop is, for drawing the day's shape. Absent if unknown. */
    location?: { lat: number; lng: number };
    /** Typical spend per person here, when the source reports one. */
    priceRange?: Place["priceRange"];
    /**
     * Google Maps directions for the hop that reaches this stop. Absent on
     * the first stop of a day, and whenever the place is unknown.
     */
    directionsUrl?: string;
  }[];
};

/**
 * A stop the catalog no longer knows about still needs a working link, and
 * a search for its id is more useful than a dead anchor.
 */
const UNKNOWN_PLACE_URL = "https://www.google.com/maps";

/**
 * Resolves an itinerary's place ids to the names, ratings and legs the summary
 * renders. Lives here rather than in the server action so it stays a plain
 * exported function that can be unit-tested ("use server" modules may only
 * export async functions).
 */
export function buildItineraryView(
  itinerary: Itinerary,
  places: readonly Place[],
  partySize = 1,
): ItineraryViewDay[] {
  const placeById = new Map(places.map((p) => [p.id, p]));
  return itinerary.days.map((day) => ({
    date: day.date,
    // Meals only: Google has no admission price for attractions and no fare
    // for transit, so a day total that included them would be invented.
    ...(() => {
      const meals = day.activities
        .map((a) => placeById.get(a.placeId))
        .filter((p): p is Place => p?.category === "restaurant");
      const cost = estimateCost(meals, partySize);
      return cost === undefined ? {} : { cost };
    })(),
    items: day.activities.map((activity, index) => {
      const place = placeById.get(activity.placeId);
      // The hop is FROM the previous stop of the same day. Links are built
      // here, server-side, where the resolved Place objects live — the view
      // stays a dumb renderer and never touches the catalog.
      const previous = placeById.get(day.activities[index - 1]?.placeId ?? "");
      return {
        placeName: place?.name ?? activity.placeId,
        start: activity.start,
        end: activity.end,
        kind: place?.category === "restaurant" ? ("meal" as const) : ("visit" as const),
        rating: place?.rating,
        travel: activity.travel,
        placeUrl: place === undefined ? UNKNOWN_PLACE_URL : placeUrl(place),
        ...(place !== undefined && { location: place.location }),
        ...(place?.priceRange !== undefined && { priceRange: place.priceRange }),
        ...(place !== undefined &&
          previous !== undefined && {
            directionsUrl: directionsUrl(
              previous,
              place,
              activity.travel?.mode ?? "transit",
            ),
          }),
      };
    }),
  }));
}

export type PlanFormState =
  | { status: "idle" }
  | {
      status: "success";
      data: TripPreferences;
      itinerary?: ItineraryViewDay[];
      planningNotice?: string;
      dataSource?: "google" | "mock";
      /** Set once the plan is stored; the share link is built from it. */
      planId?: string;
    }
  | { status: "error"; errors: string[]; values: PlanFormValues };

export const initialPlanFormState: PlanFormState = { status: "idle" };

const FIELD_LABELS: Record<string, string> = {
  startDate: "여행 시작일",
  endDate: "여행 종료일",
  "lodging.name": "숙소 이름",
  "lodging.area": "숙소 지역",
  destinations: "여행 지역",
  partySize: "인원 수",
  mustVisit: "필수 방문지",
  interests: "관심사",
  pace: "여행 속도",
  cuisines: "먹고 싶은 음식",
  constraints: "제약 조건",
};

function fieldLabel(path: string): string {
  return FIELD_LABELS[path] ?? path;
}

function splitEntries(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getStrings(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** Maps raw FormData to an untrusted candidate object for TripPreferencesSchema.safeParse. */
export function buildTripPreferencesCandidate(formData: FormData): unknown {
  // Checkboxes: several values under one name. Left as raw strings — the Zod
  // enum is what decides whether each is a constraint we honour.
  const constraints = getStrings(formData, "constraints");
  const cuisines = getStrings(formData, "cuisines");
  const destinations = getStrings(formData, "destinations");

  return {
    startDate: getString(formData, "startDate"),
    endDate: getString(formData, "endDate"),
    lodging: {
      name: getString(formData, "lodgingName"),
      area: getString(formData, "lodgingArea"),
    },
    destinations,
    partySize: Number(getString(formData, "partySize")),
    mustVisit: splitEntries(getString(formData, "mustVisit")),
    interests: splitEntries(getString(formData, "interests")),
    pace: getString(formData, "pace"),
    cuisines: cuisines.length > 0 ? cuisines : undefined,
    constraints: constraints.length > 0 ? constraints : undefined,
  };
}

/** Extracts raw submitted field strings so the form can restore them after a failed submission. */
export function extractFormValues(formData: FormData): PlanFormValues {
  return {
    startDate: getString(formData, "startDate"),
    endDate: getString(formData, "endDate"),
    lodgingName: getString(formData, "lodgingName"),
    lodgingArea: getString(formData, "lodgingArea"),
    destinations: getStrings(formData, "destinations"),
    partySize: getString(formData, "partySize"),
    mustVisit: getString(formData, "mustVisit"),
    interests: getString(formData, "interests"),
    pace: getString(formData, "pace"),
    cuisines: getStrings(formData, "cuisines"),
    constraints: getStrings(formData, "constraints"),
  };
}

/** Translates TripPreferencesSchema.safeParse failures into Korean field errors. */
export function translateSchemaErrors(error: ZodError): string[] {
  const messages = error.issues.map((issue) => {
    const path = issue.path.join(".");
    return `${fieldLabel(path)} 값이 올바르지 않습니다.`;
  });
  return Array.from(new Set(messages));
}

/** Translates validateTripPreferences business-rule failures into Korean messages. */
export function translateValidationErrors(errors: string[]): string[] {
  return errors.map((message) => {
    if (message.startsWith("endDate must be the same day as or after")) {
      return "종료일은 시작일과 같거나 이후여야 합니다.";
    }
    if (message.startsWith("Trip length")) {
      return `여행 기간이 최대 허용 일수(${MAX_TRIP_LENGTH_DAYS}일)를 초과했습니다.`;
    }
    const duplicateMatch = /^mustVisit contains duplicate entries: (.+)\.$/.exec(
      message,
    );
    if (duplicateMatch) {
      return `필수 방문지에 중복된 항목이 있습니다: ${duplicateMatch[1]}`;
    }
    if (message.startsWith("Cuisines not offered")) {
      return "선택하신 음식은 해당 여행 지역에서 제공되지 않습니다.";
    }
    if (message.startsWith("Unavailable destinations")) {
      return "선택하신 여행 지역은 아직 지원하지 않습니다.";
    }
    if (message.startsWith("partySize must be between")) {
      return `인원 수는 ${MIN_PARTY_SIZE}명에서 ${MAX_PARTY_SIZE}명 사이여야 합니다.`;
    }
    return message;
  });
}
