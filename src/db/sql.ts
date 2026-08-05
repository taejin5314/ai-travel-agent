/**
 * The narrowest thing a SQL store needs: run a parameterised statement, get
 * rows back.
 *
 * The point of the indirection is that production and CI run the *same SQL*.
 * A hand-written fake would only prove the adapter called something; it would
 * not catch a typo in a column name or a jsonb cast that Postgres rejects.
 * With this port the tests drive real Postgres in-process (pglite) while the
 * deployment drives Neon over HTTP, and neither knows about the other.
 *
 * Statements always carry their values as `$1`, `$2` placeholders. There is no
 * overload that takes an interpolated string, so there is no way to write an
 * injectable query through this interface.
 */
export type SqlRow = Record<string, unknown>;

export interface SqlClient {
  query(text: string, params: readonly unknown[]): Promise<SqlRow[]>;
}
