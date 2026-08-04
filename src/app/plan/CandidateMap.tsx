"use client";

import { useEffect, useRef } from "react";
import { googleMapsBrowserKey } from "@/lib/config";
import type { CandidateView } from "./formPreferences";

/**
 * Candidates on a real map, when a browser key exists.
 *
 * This is the first client-side external call in the repo. AGENTS.md §2 bars
 * components from calling providers or external APIs — the intent being that
 * place data must flow through a server action, which it still does: the
 * candidates here were fetched server-side and passed in as props. What the
 * browser fetches is the rendering library and its tiles, not our data.
 * Flagged in the PR for the owner rather than reinterpreted here.
 *
 * Renders nothing without a key. That is a supported state, not a failure:
 * the picker beside it works as a list, so dev and CI need no browser key.
 */
export function CandidateMap({
  candidates,
  selected,
  onToggle,
}: {
  candidates: readonly CandidateView[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  // Held in a ref so re-renders reuse the map instead of building a new one,
  // which would count as another billed map load every time a pin is tapped.
  const map = useRef<unknown>(null);
  const markers = useRef(new Map<string, { setMap: (m: unknown) => void }>());
  const apiKey = googleMapsBrowserKey();

  useEffect(() => {
    if (apiKey === undefined || container.current === null) {
      return;
    }
    let cancelled = false;

    void (async () => {
      const google = await loadMapsApi(apiKey);
      if (cancelled || container.current === null || google === undefined) {
        return;
      }
      const bounds = new google.maps.LatLngBounds();
      for (const candidate of candidates) {
        bounds.extend(candidate.location);
      }
      map.current ??= new google.maps.Map(container.current, {
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      const instance = map.current as {
        fitBounds: (b: unknown) => void;
      };
      if (candidates.length > 0) {
        instance.fitBounds(bounds);
      }

      for (const marker of markers.current.values()) {
        marker.setMap(null);
      }
      markers.current.clear();

      for (const candidate of candidates) {
        const marker = new google.maps.Marker({
          position: candidate.location,
          map: map.current,
          title: candidate.name,
          // Chosen pins are visually distinct so the map and the list agree.
          opacity: selected.has(candidate.id) ? 1 : 0.55,
        });
        marker.addListener("click", () => onToggle(candidate.id));
        markers.current.set(candidate.id, marker);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiKey, candidates, selected, onToggle]);

  if (apiKey === undefined) {
    return null;
  }
  return (
    <div
      ref={container}
      role="application"
      aria-label="후보 장소 지도"
      className="mb-3 h-64 w-full rounded-xl bg-black/[0.03] dark:bg-white/[0.06]"
    />
  );
}

type MapsApi = {
  maps: {
    Map: new (el: HTMLElement, options: unknown) => unknown;
    Marker: new (options: unknown) => {
      setMap: (m: unknown) => void;
      addListener: (event: string, handler: () => void) => void;
    };
    LatLngBounds: new () => {
      extend: (point: { lat: number; lng: number }) => void;
    };
  };
};

let loading: Promise<MapsApi | undefined> | undefined;

/**
 * Loads the Maps JS library once per page. Repeated calls share the same
 * promise: each load is billed, and a component that mounts twice should not
 * cost twice.
 */
function loadMapsApi(apiKey: string): Promise<MapsApi | undefined> {
  const existing = (globalThis as { google?: MapsApi }).google;
  if (existing?.maps !== undefined) {
    return Promise.resolve(existing);
  }
  loading ??= new Promise<MapsApi | undefined>((resolve) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.onload = () => {
      resolve((globalThis as { google?: MapsApi }).google);
    };
    // A blocked or failed script must not wedge the picker; the list still
    // works, so resolve rather than reject.
    script.onerror = () => {
      resolve(undefined);
    };
    document.head.append(script);
  });
  return loading;
}
