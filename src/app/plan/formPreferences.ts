import type { ZodError } from "zod";
import type { Itinerary } from "@/domain/schema/itinerary";
import type { Place } from "@/domain/schema/place";
import type { TravelLeg } from "@/domain/schema/travel";
import type { TripPreferences } from "@/domain/schema/tripPreferences";

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
  constraints: string;
};

/** Presentation-only view of a generated itinerary (place ids resolved to names). */
export type ItineraryViewDay = {
  date: string;
  items: {
    placeName: string;
    start: string;
    end: string;
    kind: "visit" | "meal";
    rating?: number;
    /** Hop taken to reach this stop; absent on the first stop of a day. */
    travel?: TravelLeg;
  }[];
};

/**
 * Resolves an itinerary's place ids to the names, ratings and legs the summary
 * renders. Lives here rather than in the server action so it stays a plain
 * exported function that can be unit-tested ("use server" modules may only
 * export async functions).
 */
export function buildItineraryView(
  itinerary: Itinerary,
  places: readonly Place[],
): ItineraryViewDay[] {
  const placeById = new Map(places.map((p) => [p.id, p]));
  return itinerary.days.map((day) => ({
    date: day.date,
    items: day.activities.map((activity) => {
      const place = placeById.get(activity.placeId);
      return {
        placeName: place?.name ?? activity.placeId,
        start: activity.start,
        end: activity.end,
        kind: place?.category === "restaurant" ? ("meal" as const) : ("visit" as const),
        rating: place?.rating,
        travel: activity.travel,
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
    }
  | { status: "error"; errors: string[]; values: PlanFormValues };

export const initialPlanFormState: PlanFormState = { status: "idle" };

const FIELD_LABELS: Record<string, string> = {
  startDate: "여행 시작일",
  endDate: "여행 종료일",
  "lodging.name": "숙소 이름",
  "lodging.area": "숙소 지역",
  partySize: "인원 수",
  mustVisit: "필수 방문지",
  interests: "관심사",
  pace: "여행 속도",
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

/** Maps raw FormData to an untrusted candidate object for TripPreferencesSchema.safeParse. */
export function buildTripPreferencesCandidate(formData: FormData): unknown {
  const constraints = splitEntries(getString(formData, "constraints"));

  return {
    startDate: getString(formData, "startDate"),
    endDate: getString(formData, "endDate"),
    lodging: {
      name: getString(formData, "lodgingName"),
      area: getString(formData, "lodgingArea"),
    },
    partySize: Number(getString(formData, "partySize")),
    mustVisit: splitEntries(getString(formData, "mustVisit")),
    interests: splitEntries(getString(formData, "interests")),
    pace: getString(formData, "pace"),
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
    partySize: getString(formData, "partySize"),
    mustVisit: getString(formData, "mustVisit"),
    interests: getString(formData, "interests"),
    pace: getString(formData, "pace"),
    constraints: getString(formData, "constraints"),
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
    if (message.startsWith("partySize must be between")) {
      return `인원 수는 ${MIN_PARTY_SIZE}명에서 ${MAX_PARTY_SIZE}명 사이여야 합니다.`;
    }
    return message;
  });
}
