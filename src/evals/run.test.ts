import { describe, expect, it } from "vitest";
import baseline from "@/evals/baseline.json";
import { runAllScenarios, runScenario } from "@/evals/run";
import { scenarios } from "@/evals/scenarios";

describe("eval scenarios", () => {
  it("every scenario meets its expectation", async () => {
    const results = await runAllScenarios();
    const unmet = results.filter((result) => !result.met);
    expect(unmet.map((result) => result.scenario)).toEqual([]);
  });

  it("includes a scenario the planner is expected to refuse", async () => {
    // Without this the suite could pass by accepting anything at all.
    const refused = scenarios.filter((scenario) => scenario.expect === "fails");
    expect(refused.length).toBeGreaterThan(0);

    const result = await runScenario(refused[0]);
    expect(result.planned).toBe(false);
    if (!result.planned) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("scores every planned scenario at full must-visit coverage", async () => {
    const results = await runAllScenarios();
    for (const result of results.filter((r) => r.planned)) {
      expect(result.score?.mustVisitCoverage).toBe(1);
      expect(result.score?.validatorPassed).toBe(true);
    }
  });

  it("is deterministic: two runs produce identical scorecards", async () => {
    const [first, second] = [await runAllScenarios(), await runAllScenarios()];
    expect(first).toEqual(second);
  });

  it("matches the committed baseline", async () => {
    // A diff here is not necessarily a bug — it means the planner changed and
    // the new numbers need a human look. Regenerate with `pnpm eval --update`
    // and put the before/after in the PR.
    const results = await runAllScenarios();
    expect(results).toEqual(baseline);
  });
});
