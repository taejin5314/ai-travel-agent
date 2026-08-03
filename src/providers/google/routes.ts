import type { z } from "zod";
import type { Place } from "@/domain/schema/place";
import type { TransitRide } from "@/domain/schema/travel";
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

/**
 * The rides in a transit route, in order. A step whose line has no name is
 * dropped: "이름 없는 노선" helps nobody and this is untrusted input.
 */
function ridesOf(route: ComputeRoute): TransitRide[] {
  const rides: TransitRide[] = [];
  for (const step of route.legs?.flatMap((leg) => leg.steps ?? []) ?? []) {
    const details = step.transitDetails;
    const line = details?.transitLine;
    const name = line?.nameShort ?? line?.name;
    if (details === undefined || name === undefined || name.length === 0) {
      continue;
    }
    rides.push({
      line: name,
      ...(line?.vehicle?.type !== undefined && { vehicle: line.vehicle.type }),
      ...(details.stopDetails?.departureStop?.name !== undefined && {
        from: details.stopDetails.departureStop.name,
      }),
      ...(details.stopDetails?.arrivalStop?.name !== undefined && {
        to: details.stopDetails.arrivalStop.name,
      }),
    });
  }
  return rides;
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

  private async fetchRoute(
    from: Place,
    to: Place,
    travelMode: "WALK" | "TRANSIT" | "DRIVE",
  ): Promise<ComputeRoute | undefined> {
    const response = await this.fetchFn(ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        // steps.travelMode exposes an all-walking answer to a TRANSIT
        // question; the duration alone cannot be told apart from a real ride.
        // transitDetails is where the line names live.
        "X-Goog-FieldMask":
          "routes.duration,routes.legs.steps.travelMode,routes.legs.steps.transitDetails",
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
        travelMode,
      }),
    });
    if (!response.ok) {
      throw new Error(`Google Routes computeRoutes failed (HTTP ${response.status})`);
    }
    const parsed = ComputeRoutesResponseSchema.parse(await response.json());
    return parsed.routes?.[0];
  }

  /**
   * Best available stand-in when transit routing is unavailable.
   *
   * Driving is measured over the real road network, so it beats the
   * straight-line model by a wide margin — Namba to Fushimi Inari is 52
   * minutes by road against the model's 125. It is still a proxy for a train
   * ride, never a transit measurement, so it stays flagged as an estimate and
   * carries no line names.
   */
  private async estimateTransit(from: Place, to: Place): Promise<TravelEstimate> {
    const driving = await this.fetchRoute(from, to, "DRIVE");
    if (driving === undefined) {
      return this.fallback.travelMinutes(from, to, "transit");
    }
    return {
      minutes: Math.max(1, Math.ceil(Number.parseFloat(driving.duration) / 60)),
      mode: "transit",
      estimated: true,
    };
  }

  async travelMinutes(
    from: Place,
    to: Place,
    mode: TravelMode,
  ): Promise<TravelEstimate> {
    if (from.id === to.id) {
      // Staying put takes no time. The old answer here was a fabricated one
      // minute, which surfaced as a phantom leg between a place and itself.
      return { minutes: 0, mode, estimated: false };
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

    const route = await this.fetchRoute(
      from,
      to,
      mode === "walk" ? "WALK" : "TRANSIT",
    );

    let estimate: TravelEstimate;
    if (route === undefined) {
      // No route at all — what an unserved transit pair returns. This is the
      // Namba-to-Fushimi-Inari case that used to surface as a 136-minute
      // straight-line guess; driving measures the same corridor at 52.
      estimate =
        mode === "transit"
          ? await this.estimateTransit(from, to)
          : await this.fallback.travelMinutes(from, to, mode);
    } else if (mode === "transit" && isWalkingOnly(route)) {
      // A transit question answered entirely with walking steps is not a
      // transit answer — this key is served the walking route instead. The
      // measurement is real but it answers a different question, so fall back
      // and flag it. Reporting the walk here would be honest and still wrong:
      // the planner would schedule an hour on foot between two places a train
      // connects in twenty minutes.
      estimate = await this.estimateTransit(from, to);
    } else {
      const rides = mode === "transit" ? ridesOf(route) : [];
      estimate = {
        minutes: Math.max(1, Math.ceil(Number.parseFloat(route.duration) / 60)),
        mode,
        estimated: false,
        ...(rides.length > 0 && { lines: rides }),
      };
    }
    this.cache.set(cacheKey, estimate);
    return estimate;
  }
}
