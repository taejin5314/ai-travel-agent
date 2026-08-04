/**
 * Server-side runtime configuration. Secrets are read from environment
 * variables only — never committed, never logged (AGENTS.md §3.7), and
 * never imported from client components.
 */
/**
 * The key the browser uses to draw maps. Necessarily public — a map cannot
 * render without shipping a key — which is exactly why it must NOT be
 * `GOOGLE_MAPS_API_KEY`: that one carries Places and Routes quota, and
 * exposing it would let anyone spend it.
 *
 * Restrict this one to Maps JavaScript API and our referrers. Absent is a
 * supported state: the picker falls back to a list, so dev and CI need no
 * browser key at all.
 *
 * Read from a literal `process.env.NEXT_PUBLIC_…` because Next replaces that
 * exact text at build time; a computed lookup would come back undefined in
 * the browser.
 */
export function googleMapsBrowserKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  return typeof key === "string" && key.trim().length > 0
    ? key.trim()
    : undefined;
}

export function googleMapsApiKey(): string | undefined {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (typeof key === "string" && key.trim().length > 0) {
    return key.trim();
  }
  return undefined;
}
