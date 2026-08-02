/**
 * Runs the eval scenarios against the mock catalog and prints a scorecard.
 * Offline and deterministic — safe in CI, unlike scripts/smoke-google.ts.
 *
 *   pnpm eval                     # every scenario
 *   pnpm eval osaka-two-days      # one scenario
 *   pnpm eval --update            # rewrite src/evals/baseline.json
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findScenario, scenarios } from "../src/evals/scenarios";
import { runAllScenarios, runScenario, type ScenarioResult } from "../src/evals/run";

const BASELINE_PATH = fileURLToPath(
  new URL("../src/evals/baseline.json", import.meta.url),
);

function formatRow(result: ScenarioResult): string {
  const status = result.met ? "PASS" : "FAIL";
  if (!result.planned) {
    return `${status}  ${result.scenario}\n        no itinerary: ${result.errors.join(" ")}`;
  }
  const score = result.score!;
  const coverage = `${Math.round(score.mustVisitCoverage * 100)}%`;
  return [
    `${status}  ${result.scenario}`,
    `        coverage ${coverage} · validator ${score.validatorPassed ? "ok" : "FAILED"}`,
    `        ${score.days} days · ${score.activities} stops · meals ${score.mealSlotsFilled}/${score.mealSlotsExpected}`,
    `        cross-area hops ${score.crossAreaHops} · idle ${score.idleMinutes}m`,
  ].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const name = args.find((arg) => !arg.startsWith("--"));

  let results: ScenarioResult[];
  if (name !== undefined) {
    const scenario = findScenario(name);
    if (scenario === undefined) {
      console.error(
        `Unknown scenario "${name}". Available: ${scenarios.map((s) => s.name).join(", ")}`,
      );
      process.exit(1);
    }
    results = [await runScenario(scenario)];
  } else {
    results = await runAllScenarios();
  }

  for (const result of results) {
    console.log(formatRow(result));
  }

  if (update) {
    if (name !== undefined) {
      console.error("--update rewrites the whole baseline; run it without a scenario name.");
      process.exit(1);
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`\nBaseline written to ${BASELINE_PATH}`);
    return;
  }

  const failed = results.filter((result) => !result.met);
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} scenario(s) did not meet expectations: ${failed
        .map((result) => result.scenario)
        .join(", ")}`,
    );
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
