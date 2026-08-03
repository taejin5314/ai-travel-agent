import { describe, expect, it } from "vitest";
import { plotRoute } from "@/lib/routeShape";

const SIZE = 100;

describe("plotRoute", () => {
  it("returns nothing for a day with no stops", () => {
    expect(plotRoute([])).toEqual([]);
  });

  it("centres a single stop", () => {
    const [point] = plotRoute([{ lat: 34.6873, lng: 135.5262 }]);
    expect(point).toEqual({ x: SIZE / 2, y: SIZE / 2 });
  });

  it("centres every stop when they are all at the same spot", () => {
    // No span to scale by — dividing would be a crash, and spreading them
    // out would be a lie about where they are.
    const same = { lat: 34.6873, lng: 135.5262 };
    const plotted = plotRoute([same, same, same]);
    expect(plotted).toEqual([
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 50 },
    ]);
  });

  it("puts north at the top", () => {
    const [south, north] = plotRoute([
      { lat: 34.66, lng: 135.5 },
      { lat: 34.7, lng: 135.5 },
    ]);
    expect(north.y).toBeLessThan(south.y);
  });

  it("puts east on the right", () => {
    const [west, east] = plotRoute([
      { lat: 34.66, lng: 135.5 },
      { lat: 34.66, lng: 135.55 },
    ]);
    expect(east.x).toBeGreaterThan(west.x);
  });

  it("keeps the shape rather than stretching it to fill the box", () => {
    // Twice as wide as tall must stay twice as wide as tall.
    const plotted = plotRoute([
      { lat: 34.6, lng: 135.5 },
      { lat: 34.61, lng: 135.5 },
      { lat: 34.6, lng: 135.52432 },
    ]);
    const width = Math.max(...plotted.map((p) => p.x)) - Math.min(...plotted.map((p) => p.x));
    const height = Math.max(...plotted.map((p) => p.y)) - Math.min(...plotted.map((p) => p.y));
    expect(width / height).toBeGreaterThan(1.7);
    expect(width / height).toBeLessThan(2.3);
  });

  it("keeps every point inside the padded box", () => {
    const plotted = plotRoute([
      { lat: 34.6873, lng: 135.5262 },
      { lat: 34.9671, lng: 135.7727 },
      { lat: 34.6664, lng: 135.5013 },
    ]);
    // The extreme points land exactly on the padding edge, so allow for the
    // last bit of floating-point dust rather than pretending it is not there.
    const epsilon = 1e-9;
    for (const point of plotted) {
      expect(point.x).toBeGreaterThanOrEqual(10 - epsilon);
      expect(point.x).toBeLessThanOrEqual(90 + epsilon);
      expect(point.y).toBeGreaterThanOrEqual(10 - epsilon);
      expect(point.y).toBeLessThanOrEqual(90 + epsilon);
    }
  });

  it("is deterministic", () => {
    const points = [
      { lat: 34.6873, lng: 135.5262 },
      { lat: 34.6664, lng: 135.5013 },
    ];
    expect(plotRoute(points)).toEqual(plotRoute(points));
  });
});
