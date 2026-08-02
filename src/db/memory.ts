import { randomBytes } from "node:crypto";
import type { SavedPlan } from "@/domain/schema/savedPlan";
import type { ItineraryStore, NewPlan } from "@/db/ports";

/** 96 bits of randomness, URL-safe. Enough that a share link cannot be guessed. */
const ID_BYTES = 12;

export type MemoryItineraryStoreOptions = {
  /** Injectable so tests are deterministic (AGENTS.md §5). */
  now?: () => Date;
  generateId?: () => string;
};

/**
 * In-memory plan store. AGENTS.md §1 keeps us off a real database until a
 * phase asks for one, so this is deliberately a stub: plans live for the
 * lifetime of the server process and are not shared between instances. A
 * share link therefore works within a session and a single deployment
 * instance, not forever — replacing this class with a real adapter is the
 * whole point of `ItineraryStore`.
 */
export class MemoryItineraryStore implements ItineraryStore {
  private readonly plans = new Map<string, SavedPlan>();
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: MemoryItineraryStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.generateId =
      options.generateId ?? (() => randomBytes(ID_BYTES).toString("base64url"));
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
