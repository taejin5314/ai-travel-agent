import { plotRoute } from "@/lib/routeShape";
import type { ItineraryViewDay } from "./formPreferences";

const SIZE = 100;

/**
 * The shape of one day, drawn from the coordinates already in the plan.
 *
 * Inline SVG, no tiles, no API key, no network — see lib/routeShape.ts for
 * why. The numbers match the list below it, so "stop 3 is the one that
 * doubles back" is readable at a glance, which the list alone never showed.
 */
export function DayMap({ items }: { items: ItineraryViewDay["items"] }) {
  const located = items.filter((item) => item.location !== undefined);
  // One stop has no route to show, and zero has nothing at all. If any stop
  // is missing coordinates the numbering would drift out of step with the
  // list beside it, and a map whose numbers lie is worse than no map.
  if (items.length < 2 || located.length !== items.length) {
    return null;
  }

  const points = plotRoute(
    located.map((item) => item.location as { lat: number; lng: number }),
    SIZE,
  );
  const path = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`이동 순서: ${located.map((item) => item.placeName).join(" → ")}`}
      className="mb-3 w-full max-w-64 rounded-lg bg-black/[0.03] dark:bg-white/[0.06]"
    >
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-zinc-400"
      />
      {points.map((point, index) => (
        <g key={`${located[index].start}-${located[index].placeName}`}>
          <circle
            cx={point.x}
            cy={point.y}
            r={5}
            className="fill-foreground"
          />
          <text
            x={point.x}
            y={point.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={6}
            className="fill-background"
          >
            {index + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}
