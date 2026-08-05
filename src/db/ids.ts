import { randomBytes } from "node:crypto";

/** 96 bits of randomness, URL-safe. Enough that a share link cannot be guessed. */
const ID_BYTES = 12;

/**
 * Shared by every store so the guarantee cannot drift between adapters. An id
 * that is unguessable in memory and sequential in Postgres would make the
 * share link enumerable the moment we deployed.
 */
export function newPlanId(): string {
  return randomBytes(ID_BYTES).toString("base64url");
}
