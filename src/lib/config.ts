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

/**
 * Where saved plans live. A connection string carries a password, so it is
 * read here and passed straight to the driver — never logged, never returned
 * to a caller that renders (AGENTS.md §3.7).
 *
 * Absent is a supported state: `pnpm dev` and CI fall back to the in-memory
 * store and need no database at all. Vercel's Postgres integrations set
 * `POSTGRES_URL`; `DATABASE_URL` is the same thing under the name most other
 * hosts use, and accepting both is cheaper than a support question.
 */
export function databaseUrl(): string | undefined {
  for (const name of ["POSTGRES_URL", "DATABASE_URL"] as const) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
