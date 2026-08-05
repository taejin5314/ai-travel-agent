import { MemoryItineraryStore } from "@/db/memory";
import { neonClient } from "@/db/neon";
import { PostgresItineraryStore } from "@/db/postgres";
import type { ItineraryStore } from "@/db/ports";
import { databaseUrl } from "@/lib/config";

/**
 * The process-wide store instance. Server-side only — imported by the server
 * action that saves a plan and the server component that renders one. No
 * client component may import this module: it holds a database connection
 * string, and reaching it from the browser bundle would be a leak.
 *
 * With a database configured, a share link outlives the process that made it,
 * which is the point of this module existing at all. Without one the app still
 * runs, on the in-memory store, so `pnpm dev` and CI need no setup — but a
 * link made that way dies with the server, and on serverless it will 404
 * almost at once, because the next request lands on a different instance.
 */
function selectStore(): ItineraryStore {
  const url = databaseUrl();
  if (url === undefined) {
    // Once at module load rather than per request, and carrying no value.
    console.warn(
      "[db] No POSTGRES_URL or DATABASE_URL set — saved plans will not survive a restart.",
    );
    return new MemoryItineraryStore();
  }
  return new PostgresItineraryStore(neonClient(url));
}

export const itineraryStore: ItineraryStore = selectStore();
