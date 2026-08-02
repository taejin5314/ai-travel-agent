import { MemoryItineraryStore } from "@/db/memory";
import type { ItineraryStore } from "@/db/ports";

/**
 * The process-wide store instance. Server-side only — imported by the server
 * action that saves a plan and the server component that renders one. No
 * client component may import this module: the store is a Node object holding
 * every saved plan, and reaching it from the browser bundle is both
 * impossible and a leak waiting to happen.
 *
 * Being module state, it also resets whenever the server process does. That
 * is the documented limitation of the in-memory phase, not an oversight.
 */
export const itineraryStore: ItineraryStore = new MemoryItineraryStore();
