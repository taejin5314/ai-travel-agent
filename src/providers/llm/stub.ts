import type { LlmPort } from "@/providers/ports";

/**
 * Model pinned for the future LLM phase. Kept here so the adapter, prompts,
 * and evals all reference one constant when that phase is approved.
 */
export const LLM_MODEL_ID = "claude-fable-5";

/**
 * Stub only — AGENTS.md §1 gates real LLM calls behind an explicit issue.
 * The deterministic planner in `src/agent/planTrip.ts` produces itineraries
 * until then; this class exists so the DI seam and untrusted-output contract
 * are already in place when the phase opens.
 */
export class StubLlmProvider implements LlmPort {
  async draftItinerary(): Promise<unknown> {
    throw new Error(
      `LLM provider (${LLM_MODEL_ID}) is not enabled in this phase; use the deterministic planner.`,
    );
  }
}
