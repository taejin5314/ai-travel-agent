import Link from "next/link";
import { notFound } from "next/navigation";
import { itineraryStore } from "@/db/store";
import { buildItineraryView } from "../formPreferences";
import { PlanSummary } from "../PlanSummary";

/**
 * Rendered per request, never prerendered.
 *
 * `dynamicParams` defaults to true, so a path not listed in
 * `generateStaticParams` is "generated at request time" — and then cached.
 * This page reads a database but no dynamic API, so Next would happily keep
 * the first render of each id. For a saved plan that is harmless; for a *miss*
 * it is not. Anyone who opens a share link a moment before the plan is written
 * — or during one bad database call — would pin a 404 to that url for good.
 */
export const dynamic = "force-dynamic";

export default async function SavedPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const plan = await itineraryStore.get(id);
  if (plan === null) {
    notFound();
  }

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <h1 className="text-balance text-center text-2xl font-semibold leading-tight tracking-tight">
          저장된 일정
        </h1>

        <PlanSummary
          data={plan.preferences}
          itinerary={buildItineraryView(plan.itinerary, plan.places, plan.preferences.partySize)}
          dataSource={plan.dataSource}
          pickedPlaceNames={(plan.preferences.selectedPlaceIds ?? []).map(
            (id) => plan.places.find((place) => place.id === id)?.name ?? id,
          )}
        />

        <Link
          href="/plan"
          className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400"
        >
          새 일정 만들기
        </Link>
      </div>
    </main>
  );
}
