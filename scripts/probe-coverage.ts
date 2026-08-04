/**
 * Asks the live APIs what they actually return for a destination, so
 * "can we open this city" is a command rather than a discussion.
 *
 * Google does not document where transit routing exists. Measured with one
 * key: New York, London, Paris and Seoul return real routes with line names;
 * Tokyo and Osaka return nothing at all. The only way to know is to ask, and
 * opening a city on the assumption that it works is how a traveller ends up
 * with a plan built entirely on straight-line guesses.
 *
 * Live and manual — never part of `pnpm test`, which stays offline.
 *
 *   pnpm probe                 # every registered destination
 *   pnpm probe osaka kyoto     # named destinations
 *   pnpm probe --json          # machine-readable
 *   pnpm probe --update        # rewrite fixtures/coverage.json
 *
 * Cost: 3-4 billed requests per destination (2 place searches, 1 transit
 * route, plus 1 driving route only when transit yields nothing usable).
 * Exits non-zero if any probed destination lacks measured transit.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allDestinations, findDestination } from "../src/domain/destination";
import type { Place } from "../src/domain/schema/place";
import { GooglePlacesProvider } from "../src/providers/google/places";
import { GoogleRoutesProvider } from "../src/providers/google/routes";

const COVERAGE_PATH = fileURLToPath(
  new URL("../fixtures/coverage.json", import.meta.url),
);

type Report = {
  id: string;
  country: string;
  attractions: number;
  restaurants: number;
  pricedRestaurants: number;
  /** True only when a routing service measured a real transit route. */
  transitMeasured: boolean;
  transitDetail: string;
  lines: string[];
  ready: boolean;
  notes: string[];
};

/**
 * Two places far enough apart that walking is not the answer. Adjacent
 * results from one search can be a block apart, which would prove nothing
 * about transit.
 */
function farthestPair(places: readonly Place[]): [Place, Place] | undefined {
  let best: [Place, Place] | undefined;
  let bestDistance = 0;
  for (let i = 0; i < places.length; i += 1) {
    for (let j = i + 1; j < places.length; j += 1) {
      const dLat = places[i].location.lat - places[j].location.lat;
      const dLng = places[i].location.lng - places[j].location.lng;
      const distance = dLat * dLat + dLng * dLng;
      if (distance > bestDistance) {
        bestDistance = distance;
        best = [places[i], places[j]];
      }
    }
  }
  return best;
}

async function probe(
  id: string,
  apiKey: string,
): Promise<Report | { id: string; error: string }> {
  const destination = findDestination(id);
  if (destination === undefined) {
    return { id, error: "not in fixtures/destinations.json" };
  }
  const places = new GooglePlacesProvider({ apiKey });
  const routes = new GoogleRoutesProvider({ apiKey });
  const notes: string[] = [];

  // Both searches go through the provider, so results are already dropped
  // when they fall outside the destination's bounds — which is itself part
  // of what we are checking.
  const attractions = await places.findPlacesByName(
    `top tourist attractions in ${destination.searchName}`,
  );
  const restaurants = (
    await places.findPlacesByName(
      `popular local restaurants in ${destination.searchName}`,
    )
  ).filter((place) => place.category === "restaurant");
  const pricedRestaurants = restaurants.filter(
    (place) => place.priceRange !== undefined,
  ).length;

  if (attractions.length === 0) {
    notes.push("place search returned nothing inside the destination bounds");
  }
  if (restaurants.length > 0 && pricedRestaurants === 0) {
    notes.push("no restaurant carried price data");
  }

  const pair = farthestPair(attractions);
  if (pair === undefined) {
    return {
      id,
      country: destination.country,
      attractions: attractions.length,
      restaurants: restaurants.length,
      pricedRestaurants,
      transitMeasured: false,
      transitDetail: "not tested — too few places to route between",
      lines: [],
      ready: false,
      notes: [...notes, "could not test transit: bounds may be wrong"],
    };
  }

  const estimate = await routes.travelMinutes(pair[0], pair[1], "transit");
  const measured = estimate.mode === "transit" && !estimate.estimated;
  const lines = (estimate.lines ?? []).map((ride) => ride.line);
  if (!measured) {
    notes.push(
      "transit unavailable — plans here would be built on estimates (see #46)",
    );
  }

  return {
    id,
    country: destination.country,
    attractions: attractions.length,
    restaurants: restaurants.length,
    pricedRestaurants,
    transitMeasured: measured,
    transitDetail: measured
      ? `${estimate.minutes} min measured`
      : `${estimate.minutes} min ESTIMATED (${estimate.mode})`,
    lines,
    ready: measured && attractions.length > 0,
    notes,
  };
}

function print(report: Report | { id: string; error: string }): void {
  if ("error" in report) {
    console.log(`${report.id.padEnd(12)} ERROR  ${report.error}`);
    return;
  }
  console.log(
    `${report.ready ? "READY " : "NOT READY"}  ${report.id} (${report.country})`,
  );
  console.log(
    `    places: ${report.attractions} attractions · ${report.restaurants} restaurants, ${report.pricedRestaurants} priced`,
  );
  console.log(`    transit: ${report.transitDetail}`);
  if (report.lines.length > 0) {
    console.log(`    lines: ${report.lines.join(", ")}`);
  }
  for (const note of report.notes) {
    console.log(`    ! ${note}`);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_MAPS_API_KEY is not set");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const named = args.filter((arg) => !arg.startsWith("--"));
  const ids =
    named.length > 0 ? named : allDestinations().map((entry) => entry.id);

  const reports = [];
  for (const id of ids) {
    reports.push(await probe(id, apiKey));
  }

  if (asJson) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const report of reports) {
      print(report);
    }
  }

  if (args.includes("--update")) {
    if (named.length > 0) {
      console.error(
        "--update rewrites the whole coverage record; run it without destination names.",
      );
      process.exit(1);
    }
    // Committed so the UI can offer only what was measured, and dated so a
    // stale answer is visible rather than assumed. Regenerated by command —
    // the moment this becomes a file people hand-edit, it is a claim again.
    writeFileSync(
      COVERAGE_PATH,
      `${JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          destinations: Object.fromEntries(
            reports.map((report) => [
              report.id,
              "error" in report ? { ready: false } : { ready: report.ready },
            ]),
          ),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nCoverage written to ${COVERAGE_PATH}`);
  }

  const notReady = reports.filter(
    (report) => "error" in report || !report.ready,
  );
  if (notReady.length > 0) {
    console.error(
      `\n${notReady.length} destination(s) not ready: ${notReady
        .map((report) => report.id)
        .join(", ")}`,
    );
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
