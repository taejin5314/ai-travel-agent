import type { Place } from "@/domain/schema/place";
import type { RoutesPort, TravelEstimate, TravelMode } from "@/providers/ports";

const WALK_KM_PER_HOUR = 4.5;
const TRANSIT_KM_PER_HOUR = 20;
const TRANSIT_OVERHEAD_MINUTES = 10;
const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversineDistanceKm(from: Place, to: Place): number {
  const dLat = toRadians(to.location.lat - from.location.lat);
  const dLng = toRadians(to.location.lng - from.location.lng);
  const lat1 = toRadians(from.location.lat);
  const lat2 = toRadians(to.location.lat);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Straight-line travel model. Everything it returns is `estimated: true` —
 * it has never consulted a router, and saying otherwise would make the flag
 * meaningless exactly where it matters most.
 */
export class MockRoutesProvider implements RoutesPort {
  async travelMinutes(
    from: Place,
    to: Place,
    mode: TravelMode,
  ): Promise<TravelEstimate> {
    const distanceKm = haversineDistanceKm(from, to);
    if (distanceKm === 0) {
      // Same spot: no journey to model, and rounding one up would invent one.
      return { minutes: 0, mode, estimated: false };
    }
    const speedKmPerHour = mode === "walk" ? WALK_KM_PER_HOUR : TRANSIT_KM_PER_HOUR;
    const overheadMinutes = mode === "walk" ? 0 : TRANSIT_OVERHEAD_MINUTES;
    const minutes = (distanceKm / speedKmPerHour) * 60 + overheadMinutes;

    return {
      minutes: Math.max(1, Math.ceil(minutes)),
      mode,
      estimated: true,
    };
  }
}
