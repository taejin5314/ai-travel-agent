import type { z } from "zod";
import type { Place } from "@/domain/schema/place";
import type { RoutesPort, TravelEstimate, TravelMode } from "@/providers/ports";
import { MockRoutesProvider } from "@/providers/mock/routes";
import { ComputeRoutesResponseSchema } from "@/providers/google/schema";

const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

/**
 * Beyond this distance nobody walks between stops; skip the API call and
 * use the deterministic estimate so quota is not wasted on doomed queries
 * (the planner only accepts walks of at most ~20 minutes anyway).
 */
const MAX_REASONABLE_WALK_KM = 2.5;

const EARTH_RADIUS_KM = 6371;

type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GoogleRoutesProviderOptions {
  apiKey: string;
  fetchFn?: FetchLike;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversineKm(from: Place, to: Place): number {
  const dLat = toRadians(to.location.lat - from.location.lat);
  const dLng = toRadians(to.location.lng - from.location.lng);
  const lat1 = toRadians(from.location.lat);
  const lat2 = toRadians(to.location.lat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type ComputeRoute = NonNullable<
  z.infer<typeof ComputeRoutesResponseSchema>["routes"]
>[number];

/**
 * True when the route contains steps and none of them is a ride. An empty or
 * absent step list is NOT treated as walking — we simply do not know, and
 * guessing is the behaviour this whole change exists to remove.
 */
function isWalkingOnly(route: ComputeRoute): boolean {
  const steps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  return (
    steps.length > 0 && steps.every((step) => step.travelMode === "WALK")
  );
}

export class GoogleRoutesProvider implements RoutesPort {
  private readonly apiKey: string;
  private readonly fetchFn: FetchLike;
  private readonly cache = new Map<string, TravelEstimate>();
  /** Deterministic fallback when the API has no route (e.g. transit gaps). */
  private readonly fallback = new MockRoutesProvider();

  constructor(options: GoogleRoutesProviderOptions) {
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? (fetch as unknown as FetchLike);
  }

  async travelMinutes(
    from: Place,
    to: Place,
    mode: TravelMode,
  ): Promise<TravelEstimate> {
    if (from.id === to.id) {
      return { minutes: 1, mode, estimated: true };
    }
    const cacheKey = `${from.id}|${to.id}|${mode}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    if (mode === "walk" && haversineKm(from, to) > MAX_REASONABLE_WALK_KM) {
      const estimate = await this.fallback.travelMinutes(from, to, mode);
      this.cache.set(cacheKey, estimate);
      return estimate;
    }

    const response = await this.fetchFn(ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        // steps.travelMode is what exposes an all-walking answer to a TRANSIT
        // question; the duration alone cannot be told apart from a real ride.
        "X-Goog-FieldMask": "routes.duration,routes.legs.steps.travelMode",
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: { latitude: from.location.lat, longitude: from.location.lng },
          },
        },
        destination: {
          location: {
            latLng: { latitude: to.location.lat, longitude: to.location.lng },
          },
        },
        travelMode: mode === "walk" ? "WALK" : "TRANSIT",
      }),
    });
    if (!response.ok) {
      throw new Error(`Google Routes computeRoutes failed (HTTP ${response.status})`);
    }
    const parsed = ComputeRoutesResponseSchema.parse(await response.json());
    const route = parsed.routes?.[0];

    let estimate: TravelEstimate;
    if (route === undefined) {
      // No route at all. Common beyond walking range when transit is not
      // served for the pair; the model is the only answer available, and it
      // is labelled as one.
      estimate = await this.fallback.travelMinutes(from, to, mode);
    } else {
      estimate = {
        minutes: Math.max(1, Math.ceil(Number.parseFloat(route.duration) / 60)),
        // A transit query answered entirely with walking steps IS a walk.
        // Reporting the requested mode here is what put "🚃 60분" on a
        // 4.3 km stroll.
        mode: mode === "transit" && isWalkingOnly(route) ? "walk" : mode,
        estimated: false,
      };
    }
    this.cache.set(cacheKey, estimate);
    return estimate;
  }
}
