export type GeoPoint = { lat: number; lng: number };
export type PlottedPoint = { x: number; y: number };

/**
 * Projects a day's stops onto a square drawing area.
 *
 * Deliberately not a map: no tiles, no key, no network. The question a
 * traveller asks looking at a day is "does this route double back on
 * itself?", and the shape answers it. Streets would answer a different
 * question, and the 길찾기 links already hand that to Google Maps.
 *
 * Equirectangular, with longitude scaled by cos(latitude): over a city the
 * error is invisible, and it keeps north-south from looking east-west.
 * Both axes share one scale, so the shape is never stretched to fill the box.
 */
export function plotRoute(
  points: readonly GeoPoint[],
  size = 100,
  padding = 10,
): PlottedPoint[] {
  if (points.length === 0) {
    return [];
  }

  const meanLat =
    points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const lngScale = Math.cos((meanLat * Math.PI) / 180);
  // Screen y grows downward; latitude grows north. Negate so north is up.
  const raw = points.map((point) => ({
    x: point.lng * lngScale,
    y: -point.lat,
  }));

  const xs = raw.map((point) => point.x);
  const ys = raw.map((point) => point.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const centerX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const centerY = (Math.max(...ys) + Math.min(...ys)) / 2;

  const usable = size - padding * 2;
  // One span for both axes preserves the shape. A day with every stop at the
  // same spot has no span at all; anything non-zero avoids dividing by it,
  // and every point lands on the centre, which is the truth.
  const span = Math.max(spanX, spanY);
  const scale = span > 0 ? usable / span : 0;

  return raw.map((point) => ({
    x: size / 2 + (point.x - centerX) * scale,
    y: size / 2 + (point.y - centerY) * scale,
  }));
}
