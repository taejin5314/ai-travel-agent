import type { SavedPlan } from "@/domain/schema/savedPlan";

/** A saved plan without the fields the store itself assigns. */
export type NewPlan = Omit<SavedPlan, "id" | "createdAt">;

/**
 * Persistence boundary for generated plans. Narrow on purpose: everything the
 * app needs today is "keep this plan" and "give me that plan". Swapping the
 * in-memory store for a real database later means implementing this
 * interface, not touching callers.
 */
export interface ItineraryStore {
  /** Stores a plan and returns it with the id and timestamp the store assigned. */
  save(plan: NewPlan): Promise<SavedPlan>;
  get(id: string): Promise<SavedPlan | null>;
}
