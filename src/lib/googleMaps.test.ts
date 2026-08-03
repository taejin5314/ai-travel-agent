import { describe, expect, it } from "vitest";
import type { Place } from "@/domain/schema/place";
import { directionsUrl, placeUrl } from "@/lib/googleMaps";

const open = { open: "09:00", close: "18:00" };

function place(id: string, lat: number, lng: number): Place {
  return {
    id,
    name: id,
    area: "osaka",
    category: "sight",
    location: { lat, lng },
    openingHours: [open, open, open, open, open, open, open],
    typicalVisitMinutes: 60,
  };
}

const castle = place("osaka-castle", 34.6873, 135.5262);
const dotonbori = place("dotonbori", 34.6687, 135.5013);

describe("directionsUrl", () => {
  it("routes between the two stops in transit mode by default", () => {
    const url = new URL(directionsUrl(castle, dotonbori));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("origin")).toBe("34.6873,135.5262");
    expect(url.searchParams.get("destination")).toBe("34.6687,135.5013");
    expect(url.searchParams.get("travelmode")).toBe("transit");
  });

  it("uses Google's own word for a walking leg", () => {
    // Our domain says "walk"; the Maps URL scheme says "walking".
    const url = new URL(directionsUrl(castle, dotonbori, "walk"));
    expect(url.searchParams.get("travelmode")).toBe("walking");
  });

  it("is directional", () => {
    const there = new URL(directionsUrl(castle, dotonbori));
    const back = new URL(directionsUrl(dotonbori, castle));
    expect(there.searchParams.get("origin")).toBe(
      back.searchParams.get("destination"),
    );
    expect(there.searchParams.get("destination")).toBe(
      back.searchParams.get("origin"),
    );
  });

  it("identifies places by coordinates, never by name", () => {
    // A name can resolve to the wrong restaurant in another city; the
    // coordinates are what the plan actually means.
    const ambiguous = place("쿠우야", 34.6688, 135.5014);
    const url = new URL(directionsUrl(castle, ambiguous));
    expect(url.searchParams.get("destination")).toBe("34.6688,135.5014");
    expect(url.href).not.toContain(encodeURIComponent("쿠우야"));
  });
});

describe("placeUrl", () => {
  it("points at the stop's coordinates", () => {
    const url = new URL(placeUrl(castle));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/search/");
    expect(url.searchParams.get("query")).toBe("34.6873,135.5262");
  });
});
