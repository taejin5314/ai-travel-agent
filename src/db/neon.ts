import { neon } from "@neondatabase/serverless";
import type { SqlClient, SqlRow } from "@/db/sql";

/**
 * The `SqlClient` the deployment uses: Neon's HTTP driver.
 *
 * HTTP rather than a pooled TCP connection because the app runs on serverless
 * functions, where a connection pool is a liability — instances come and go
 * per request and would each hold sockets a plan lookup does not need. One
 * request, one round trip.
 *
 * This file is the only place that knows which vendor we bought; everything
 * above it sees `SqlClient`.
 */
export function neonClient(connectionString: string): SqlClient {
  const sql = neon(connectionString);
  return {
    async query(text, params): Promise<SqlRow[]> {
      // `sql.query` takes $1-style placeholders and an array — the same shape
      // pglite takes in tests, so the statement itself never varies.
      return (await sql.query(text, [...params])) as SqlRow[];
    },
  };
}
