"use client";

import { useEffect, useState } from "react";
import { discoverCandidates } from "./actions";
import { CandidateMap } from "./CandidateMap";
import type { CandidateView } from "./formPreferences";

/**
 * Choose the places, then let the planner schedule them.
 *
 * This is the step that removes the app's weakest guess. Inferring taste from
 * interests and ratings is how a live plan served a sushi-making class for
 * dinner; if the traveller points at what they want, there is nothing left to
 * infer.
 *
 * Selection is submitted as hidden inputs so the whole form remains a plain
 * server-action POST — no client-side plan request, no second source of truth.
 */
export function PlacePicker({
  destinations,
  cuisines,
}: {
  destinations: readonly string[];
  cuisines: readonly string[];
}) {
  const [candidates, setCandidates] = useState<CandidateView[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const key = [...destinations].sort().join(",");
  const cuisineKey = [...cuisines].sort().join(",");

  useEffect(() => {
    // Nothing to fetch, and nothing to clear: with no destination the whole
    // picker renders null, so leftover candidates are invisible and are
    // replaced the moment a destination is chosen again. Clearing them here
    // would be a synchronous setState inside an effect.
    if (destinations.length === 0) {
      return;
    }
    let cancelled = false;
    void discoverCandidates({
      destinations: key.split(",").filter(Boolean),
      cuisines: cuisineKey.split(",").filter(Boolean),
      limit: 24,
    })
      .then((found) => {
        if (!cancelled) {
          setCandidates([...found.attractions, ...found.restaurants]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // Keyed on the joined ids so re-ordering the same choices does not refetch
    // — every fetch is billed.
  }, [key, cuisineKey, destinations.length]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (destinations.length === 0) {
    return null;
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        가고 싶은 곳 고르기 (선택)
      </legend>
      <p className="text-xs text-zinc-500">
        고른 장소는 일정에 반드시 포함됩니다. 고르지 않으면 평점과 관심사를
        기준으로 저희가 채웁니다.
      </p>

      {loading && candidates.length === 0 ? (
        <p className="py-3 text-sm text-zinc-500">후보를 불러오는 중…</p>
      ) : (
        <>
          <CandidateMap
            candidates={candidates}
            selected={selected}
            onToggle={toggle}
          />
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(candidate.id)}
                    onChange={() => toggle(candidate.id)}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span className="flex flex-col">
                    <span>
                      {candidate.category === "restaurant" ? "🍽️ " : ""}
                      {candidate.name}
                      {candidate.rating !== undefined && (
                        <span className="ml-1 text-xs text-zinc-500">
                          ★ {candidate.rating.toFixed(1)}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-zinc-500">
                      약 {candidate.visitMinutes}분
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {[...selected].map((id) => (
        <input key={id} type="hidden" name="selectedPlaceIds" value={id} />
      ))}
    </fieldset>
  );
}
