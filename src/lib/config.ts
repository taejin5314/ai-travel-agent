/**
 * Server-side runtime configuration. Secrets are read from environment
 * variables only — never committed, never logged (AGENTS.md §3.7), and
 * never imported from client components.
 */
export function googleMapsApiKey(): string | undefined {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (typeof key === "string" && key.trim().length > 0) {
    return key.trim();
  }
  return undefined;
}
