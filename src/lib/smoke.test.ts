import { describe, expect, it } from "vitest";

/**
 * Smoke test: proves the test harness (vitest + TS + path resolution) is wired
 * up and runs in CI. Replace/extend with real tests as domain code lands.
 */
describe("smoke", () => {
  it("runs the test harness", () => {
    expect(1 + 1).toBe(2);
  });

  it("supports async assertions", async () => {
    const value = await Promise.resolve("ok");
    expect(value).toBe("ok");
  });
});
