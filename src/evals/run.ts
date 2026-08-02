import { planTrip } from "@/agent/planTrip";
import { MockPlacesProvider } from "@/providers/mock/places";
import { MockRoutesProvider } from "@/providers/mock/routes";
import { scenarios, type Scenario } from "@/evals/scenarios";
import { scoreItinerary, type Scorecard } from "@/evals/score";

export type ScenarioResult = {
  scenario: string;
  planned: boolean;
  /** Whether the outcome matched the scenario's `expect`. */
  met: boolean;
  errors: string[];
  score?: Scorecard;
};

/**
 * Runs one scenario end-to-end against the MOCK providers. Offline and
 * deterministic by construction: fresh provider instances per run, a fixed
 * fixture catalog, and no clock or randomness anywhere in the planner
 * (AGENTS.md §5).
 */
export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const places = new MockPlacesProvider();
  const result = await planTrip(scenario.preferences, {
    places,
    routes: new MockRoutesProvider(),
  });

  if (!result.ok) {
    return {
      scenario: scenario.name,
      planned: false,
      met: scenario.expect === "fails",
      errors: result.errors,
    };
  }

  return {
    scenario: scenario.name,
    planned: true,
    met: scenario.expect === "plans",
    errors: [],
    score: scoreItinerary(
      result.itinerary,
      await places.listPlaces(),
      scenario.preferences,
    ),
  };
}

export async function runAllScenarios(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }
  return results;
}
