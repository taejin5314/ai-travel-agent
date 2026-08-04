/**
 * Local-only smoke check for the Google providers. Not part of `pnpm test`
 * (that stays offline/deterministic per AGENTS.md §5). Run manually:
 *   npx tsx --env-file=.env.local scripts/smoke-google.ts
 */
import { planTrip } from "../src/agent/planTrip";
import type { TripPreferences } from "../src/domain/schema/tripPreferences";
import { GooglePlacesProvider } from "../src/providers/google/places";
import { GoogleRoutesProvider } from "../src/providers/google/routes";

const apiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!apiKey) {
  console.error("GOOGLE_MAPS_API_KEY is not set");
  process.exit(1);
}

const preferences: TripPreferences = {
  startDate: "2026-08-10",
  endDate: "2026-08-12",
  lodging: { name: "Cross Hotel Osaka", area: "난바" },
  destinations: ["osaka", "kyoto"],
  partySize: 2,
  mustVisit: ["오사카성", "후시미 이나리"],
  interests: ["음식", "문화"],
  pace: "balanced",
};

const ports = {
  places: new GooglePlacesProvider({ apiKey }),
  routes: new GoogleRoutesProvider({ apiKey }),
};

async function main(): Promise<void> {
  const started = Date.now();
  const result = await planTrip(preferences, ports);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.ok) {
    console.error(`planTrip failed after ${elapsed}s:`, result.errors);
    process.exit(1);
  }

  const catalog = await ports.places.listPlaces();
  const byId = new Map(catalog.map((p) => [p.id, p]));

  console.log(`\n일정 생성 성공 (${elapsed}s, 카탈로그 ${catalog.length}곳)\n`);
  for (const day of result.itinerary.days) {
    console.log(`[${day.date}]`);
    for (const activity of day.activities) {
      const place = byId.get(activity.placeId);
      const rating = place?.rating !== undefined ? ` ★${place.rating}` : "";
      const meal = place?.category === "restaurant" ? "[식사] " : "";
      console.log(
        `  ${activity.start}-${activity.end} ${meal}${place?.name ?? activity.placeId}${rating}`,
      );
    }
  }
}

void main();
