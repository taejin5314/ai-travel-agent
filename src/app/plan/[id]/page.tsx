import Link from "next/link";
import { notFound } from "next/navigation";
import { itineraryStore } from "@/db/store";
import { buildItineraryView } from "../formPreferences";
import { PlanSummary } from "../PlanSummary";

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
