import { MemoryItineraryStore } from "@/db/memory";
import { describeItineraryStore } from "@/db/storeContract";

// The fixture and the assertions moved to storeContract.ts when Postgres
// arrived: these tests were always about the interface, and now something
// else has to satisfy it too.
describeItineraryStore(
  "MemoryItineraryStore",
  async (options) => new MemoryItineraryStore(options),
);
