import type { SavedPlan } from "@/domain/schema/savedPlan";
import type { ItineraryStore, NewPlan } from "@/db/ports";
import { newPlanId } from "@/db/ids";

export type MemoryItineraryStoreOptions = {
  /** Injectable so tests are deterministic (AGENTS.md §5). */
  now?: () => Date;
  generateId?: () => string;
};

/**
 * In-memory plan store. Plans live for the lifetime of the server process and
 * are not shared between instances, so a share link made against this store
 * works within one session and nowhere else.
 *
 * That is no longer the app's normal state — `PostgresItineraryStore` is —
 * but it stays as the zero-configuration fallback: `pnpm dev` and CI should
 * not need a database to run, and holding both to `storeContract.ts` is what
 * keeps the fallback honest.
 */
export class MemoryItineraryStore implements ItineraryStore {
  private readonly plans = new Map<string, SavedPlan>();
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: MemoryItineraryStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? newPlanId;
  }

  async save(plan: NewPlan): Promise<SavedPlan> {
    const saved: SavedPlan = {
      ...plan,
      id: this.generateId(),
      createdAt: this.now().toISOString(),
    };
    this.plans.set(saved.id, saved);
    return saved;
  }

  async get(id: string): Promise<SavedPlan | null> {
    return this.plans.get(id) ?? null;
  }
}
