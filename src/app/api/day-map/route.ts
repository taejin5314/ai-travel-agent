import { destinationAt } from "@/domain/destination";
import { googleMapsApiKey } from "@/lib/config";

const STATIC_MAPS = "https://maps.googleapis.com/maps/api/staticmap";

/**
 * How many stops a day can plausibly have. The cap is not decoration: this
 * endpoint is public, and without it someone could ask for a thousand-point
 * map and bill it to us.
 */
const MAX_POINTS = 12;

type Point = { lat: number; lng: number };

/** `lat,lng|lat,lng…` → points, or undefined if anything is not a coordinate. */
function parsePoints(raw: string | null): Point[] | undefined {
  if (raw === null || raw.length === 0) {
    return undefined;
  }
  const parts = raw.split("|");
  if (parts.length > MAX_POINTS) {
    return undefined;
  }
  const points: Point[] = [];
  for (const part of parts) {
    const [lat, lng] = part.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return undefined;
    }
    // Only places inside a destination we actually serve. This is what stops
    // the route being a general-purpose image proxy on our quota.
    if (destinationAt(lat, lng) === undefined) {
      return undefined;
    }
    points.push({ lat, lng });
  }
  return points;
}

/**
 * A day's route as a map image, fetched server-side.
 *
 * The proxy exists so the key stays here: an `<img src>` pointing straight at
 * Google would put `GOOGLE_MAPS_API_KEY` — which carries Places and Routes
 * quota — into the page source for anyone to take.
 *
 * Returns 502 when Static Maps is unavailable (it is not enabled on the
 * project today), and the client falls back to the inline SVG shape.
 */
export async function GET(request: Request): Promise<Response> {
  // Input first: a malformed request is the caller's fault whether or not we
  // happen to have a key, and answering 502 to bad coordinates would blame
  // the wrong side.
  const points = parsePoints(new URL(request.url).searchParams.get("points"));
  if (points === undefined || points.length === 0) {
    return new Response("bad points", { status: 400 });
  }
  const apiKey = googleMapsApiKey();
  if (apiKey === undefined) {
    return new Response("no map key", { status: 502 });
  }

  const url = new URL(STATIC_MAPS);
  url.searchParams.set("size", "640x360");
  url.searchParams.set("scale", "2");
  url.searchParams.set("maptype", "roadmap");
  url.searchParams.set(
    "path",
    `color:0x3b82f6cc|weight:4|${points.map((p) => `${p.lat},${p.lng}`).join("|")}`,
  );
  for (const [index, point] of points.entries()) {
    // Numbered to match the list beside it; Google only labels 1-9 and A-Z,
    // so later stops fall back to a plain dot rather than a wrong number.
    const label = index < 9 ? `label:${index + 1}|` : "";
    url.searchParams.append(
      "markers",
      `${label}color:0x1d4ed8|${point.lat},${point.lng}`,
    );
  }
  url.searchParams.set("key", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    // Never forward Google's body: it can name the project and the API.
    return new Response("map unavailable", { status: 502 });
  }
  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "image/png",
      // A day's route does not change once planned.
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
