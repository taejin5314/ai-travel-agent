import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it } from "vitest";
import { PostgresItineraryStore } from "@/db/postgres";
import type { SqlClient, SqlRow } from "@/db/sql";
import { contractPlan, describeItineraryStore } from "@/db/storeContract";

/**
 * Real Postgres, in this process: no network, and the same SQL the deployment
 * runs — which is the whole reason the `SqlClient` port exists. A hand-written
 * fake would have accepted a misspelled column without complaint.
 *
 * One database, many store instances, deliberately. Plan ids are random, so
 * tests cannot collide through the shared table, and every store built here is
 * cold — which is exactly the situation this change is about: several
 * serverless instances reading one database. Booting a fresh Postgres per test
 * would be both slower and less like production.
 */
const open: PGlite[] = [];

function clientFor(db: PGlite): SqlClient {
  open.push(db);
  return {
    async query(text, params): Promise<SqlRow[]> {
      return (await db.query<SqlRow>(text, [...params])).rows;
    },
  };
}

let shared: SqlClient | undefined;

async function pgliteClient(): Promise<SqlClient> {
  shared ??= clientFor(new PGlite());
  return shared;
}

afterAll(async () => {
  shared = undefined;
  await Promise.all(open.splice(0).map((db) => db.close()));
});

describeItineraryStore(
  "PostgresItineraryStore",
  async (options) => new PostgresItineraryStore(await pgliteClient(), options),
);

describe("PostgresItineraryStore", () => {
  it("survives the process that saved the plan", async () => {
    // The bug this whole change exists for. Two stores sharing nothing but
    // the database, exactly as two serverless instances would be.
    const client = await pgliteClient();

    const saved = await new PostgresItineraryStore(client).save(contractPlan);
    const readByAnotherInstance = await new PostgresItineraryStore(client).get(saved.id);

    expect(readByAnotherInstance).toEqual(saved);
  });

  it("creates its table only when it is missing", async () => {
    // migrate() runs on every cold instance, so it must be safe to run forever
    // — including against a table that already holds other tests' plans.
    const store = new PostgresItineraryStore(await pgliteClient());
    const first = await store.save(contractPlan);
    await store.save(contractPlan);
    expect(await store.get(first.id)).not.toBeNull();
  });

  it("refuses a row it can no longer parse rather than rendering it", async () => {
    // A plan written by an older build. AGENTS.md §7 treats a row as
    // untrusted even though we wrote it, and a 404 beats a plan with days
    // silently missing.
    const client = await pgliteClient();
    const store = new PostgresItineraryStore(client);
    const saved = await store.save(contractPlan);
    await client.query(`update plans set document = $1 where id = $2`, [
      JSON.stringify({ preferences: { partySize: 2 } }),
      saved.id,
    ]);

    await expect(store.get(saved.id)).resolves.toBeNull();
  });

  it("stores values as parameters, so a plan cannot carry SQL into the table", async () => {
    const client = await pgliteClient();
    const store = new PostgresItineraryStore(client);
    const hostile = {
      ...contractPlan,
      preferences: {
        ...contractPlan.preferences,
        mustVisit: ["'); drop table plans; --"],
      },
    };

    const saved = await store.save(hostile);

    expect((await store.get(saved.id))?.preferences.mustVisit).toEqual([
      "'); drop table plans; --",
    ]);
    // The table is still there, which it would not be if that string had
    // reached the parser.
    await expect(store.get("does-not-exist")).resolves.toBeNull();
  });

  it("does not cache a failed migration onto every later call", async () => {
    let attempts = 0;
    const real = await pgliteClient();
    const flaky: SqlClient = {
      async query(text, params) {
        if (text.includes("create table")) {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("connection reset");
          }
        }
        return real.query(text, params);
      },
    };
    const store = new PostgresItineraryStore(flaky);

    await expect(store.save(contractPlan)).rejects.toThrow("connection reset");
    // A memoised rejected promise would make the instance permanently broken.
    await expect(store.save(contractPlan)).resolves.toHaveProperty("id");
  });
});
