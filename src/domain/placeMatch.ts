import type { Place } from "@/domain/schema/place";

/**
 * How a user-typed place name is matched against the catalog. Pure string
 * work over domain types — no IO — so the mock provider, the planner, and the
 * eval scorer can all share one definition instead of three that drift.
 *
 * That drift is the reason this file exists: the scorer used to credit
 * must-visit coverage to ANY place whose name contained the request, while
 * the planner resolves a request to exactly one place. "Castle" then counted
 * Nijo Castle as covering a requested Osaka Castle.
 */

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Loose match: the query appears somewhere in the name or an alias. */
export function matchesName(place: Place, query: string): boolean {
  const needle = normalize(query);
  return (
    place.name.toLowerCase().includes(needle) ||
    (place.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle))
  );
}

/** Strict match: the query IS the name or an alias. */
export function matchesExactly(place: Place, query: string): boolean {
  const needle = normalize(query);
  return (
    normalize(place.name) === needle ||
    (place.aliases ?? []).some((alias) => normalize(alias) === needle)
  );
}

/**
 * The single place a request resolves to, using the planner's own rule:
 * prefer an exact name/alias hit, otherwise take the first loose match in
 * catalog order.
 */
export function resolvePlace(
  places: readonly Place[],
  query: string,
): Place | undefined {
  const matches = places.filter((place) => matchesName(place, query));
  return matches.find((place) => matchesExactly(place, query)) ?? matches[0];
}
