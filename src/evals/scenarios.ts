import type { TripPreferences } from "@/domain/schema/tripPreferences";

/**
 * A named planning case run against the mock catalog. `expect` records what
 * the scenario is FOR: most prove the planner produces a usable trip, but the
 * suite also needs cases the planner must refuse, so a harness that silently
 * accepts everything is detectable.
 */
export type Scenario = {
  name: string;
  description: string;
  preferences: TripPreferences;
  expect: "plans" | "fails";
};

// 2026-10-05 is a Monday. Osaka Castle is closed Mondays in the fixture,
// which is what makes the `must-visit-closed` case unsatisfiable.
const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const THURSDAY = "2026-10-08";

const osakaLodging = { name: "Cross Hotel Osaka", area: "Namba" };

const paceBaseline: Omit<TripPreferences, "pace"> = {
  startDate: TUESDAY,
  endDate: THURSDAY,
  lodging: osakaLodging,
  destinations: ["osaka", "kyoto"],
  partySize: 2,
  mustVisit: ["오사카성"],
  interests: ["음식", "문화"],
};

export const scenarios: Scenario[] = [
  {
    name: "osaka-two-days",
    description: "Single city, two days, one must-visit and food interests.",
    expect: "plans",
    preferences: {
      startDate: TUESDAY,
      endDate: "2026-10-07",
      lodging: osakaLodging,
      destinations: ["osaka", "kyoto"],
      partySize: 2,
      mustVisit: ["오사카성"],
      interests: ["음식"],
      pace: "balanced",
    },
  },
  {
    name: "osaka-kyoto-three-days",
    description:
      "Must-visits in both cities — the case that stranded Fushimi Inari on real data.",
    expect: "plans",
    preferences: {
      startDate: TUESDAY,
      endDate: THURSDAY,
      lodging: osakaLodging,
      destinations: ["osaka", "kyoto"],
      partySize: 2,
      mustVisit: ["오사카성", "후시미"],
      interests: ["문화", "음식"],
      pace: "balanced",
    },
  },
  {
    name: "must-visit-closed",
    description:
      "The only day of the trip is the one day the must-visit is closed; the planner must refuse rather than quietly drop it.",
    expect: "fails",
    preferences: {
      startDate: MONDAY,
      endDate: MONDAY,
      lodging: osakaLodging,
      destinations: ["osaka", "kyoto"],
      partySize: 2,
      mustVisit: ["오사카성"],
      interests: [],
      pace: "balanced",
    },
  },
  {
    name: "pace-relaxed",
    description: "Identical input to pace-packed; only the pace differs.",
    expect: "plans",
    preferences: { ...paceBaseline, pace: "relaxed" },
  },
  {
    name: "pace-packed",
    description: "Identical input to pace-relaxed; only the pace differs.",
    expect: "plans",
    preferences: { ...paceBaseline, pace: "packed" },
  },
];

export function findScenario(name: string): Scenario | undefined {
  return scenarios.find((scenario) => scenario.name === name);
}
