import type { Place } from "@/domain/schema/place";
import type { TravelMode } from "@/domain/schema/travel";

/**
 * Links into Google Maps, built with the public Maps URLs scheme.
 *
 * This is how the app answers "which train do I take". Google's routing APIs
 * return no transit for Japan — verified across Tokyo and Osaka, while the
 * same key returns line names for Seoul, London and New York — but the Google
 * Maps app itself has Japanese rail, with live times and platform numbers.
 * Handing the leg over is therefore strictly better than anything we could
 * render: it is real, current, and already installed on the traveller's phone.
 *
 * Coordinates rather than place ids or names: they mean the same thing to
 * every provider we have, cannot resolve to the wrong "Kuuya", and need no
 * guessing about which id format a catalog entry carries.
 */
const DIR_BASE = "https://www.google.com/maps/dir/?api=1";
const SEARCH_BASE = "https://www.google.com/maps/search/?api=1";

function coords(place: Place): string {
  return `${place.location.lat},${place.location.lng}`;
}

/** Google Maps' name for the mode; our "transit" and "walk" are its own words. */
function travelmode(mode: TravelMode): string {
  return mode === "walk" ? "walking" : "transit";
}

export function directionsUrl(
  from: Place,
  to: Place,
  mode: TravelMode = "transit",
): string {
  const params = new URLSearchParams({
    origin: coords(from),
    destination: coords(to),
    travelmode: travelmode(mode),
  });
  return `${DIR_BASE}&${params.toString()}`;
}

export function placeUrl(place: Place): string {
  return `${SEARCH_BASE}&${new URLSearchParams({ query: coords(place) }).toString()}`;
}
