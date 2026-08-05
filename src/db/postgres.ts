import type { ItineraryStore, NewPlan } from "@/db/ports";
import type { SqlClient } from "@/db/sql";
import { newPlanId } from "@/db/ids";
import { SavedPlanSchema, type SavedPlan } from "@/domain/schema/savedPlan";

export type PostgresItineraryStoreOptions = {
  /** Injectable so tests are deterministic (AGENTS.md §5). */
  now?: () => Date;
  generateId?: () => string;
};

/**
 * One row per plan: the identity in columns, the plan itself in `jsonb`.
 *
 * The split is deliberate. `id` and `created_at` are the store's own
 * assignments and belong to the table, so they can be indexed and ordered.
 * Everything else is domain data whose shape is still moving, and putting it
 * in one document means adding a field to `SavedPlan` does not require a
 * migration. Nothing is stored twice, so no column can ever disagree with the
 * document beside it.
 *
 * `if not exists` and nothing else — this never drops or rewrites, which
 * AGENTS.md §3.5 forbids doing unattended.
 */
const CREATE_TABLE = `
  create table if not exists plans (
    id text primary key,
    created_at timestamptz not null,
    document jsonb not null
  )
`;

const INSERT = `insert into plans (id, created_at, document) values ($1, $2, $3)`;
const SELECT = `select id, created_at, document from plans where id = $1`;

/**
 * `created_at` comes back as a `Date` from both drivers today, but a driver
 * that hands over the raw string is a plausible future and not worth a crash.
 */
function toIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

/** jsonb arrives parsed from both drivers; a string is tolerated the same way. */
function toDocument(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Plans in Postgres, so a share link outlives the process that made it.
 *
 * Rows are untrusted input (AGENTS.md §7) even though we wrote them: a row
 * written by an older build can no longer match today's schema, and the
 * honest response is to fail closed and 404 rather than render a plan with
 * missing days. `get` therefore parses, and returns null when it cannot.
 */
export class PostgresItineraryStore implements ItineraryStore {
  private readonly sql: SqlClient;
  private readonly now: () => Date;
  private readonly generateId: () => string;
  /**
   * Memoised, not awaited per call: serverless gives us a fresh instance often
   * enough that the DDL has to be self-healing, but running it on every save
   * would be a round trip bought for nothing.
   */
  private ready: Promise<void> | undefined;

  constructor(sql: SqlClient, options: PostgresItineraryStoreOptions = {}) {
    this.sql = sql;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? newPlanId;
  }

  private async migrate(): Promise<void> {
    this.ready ??= this.sql.query(CREATE_TABLE, []).then(() => undefined);
    try {
      await this.ready;
    } catch (error) {
      // A failed attempt must not poison every later call in this instance.
      this.ready = undefined;
      throw error;
    }
  }

  async save(plan: NewPlan): Promise<SavedPlan> {
    await this.migrate();
    const saved: SavedPlan = {
      ...plan,
      id: this.generateId(),
      createdAt: this.now().toISOString(),
    };
    const { id, createdAt, ...document } = saved;
    await this.sql.query(INSERT, [id, createdAt, JSON.stringify(document)]);
    return saved;
  }

  async get(id: string): Promise<SavedPlan | null> {
    await this.migrate();
    const rows = await this.sql.query(SELECT, [id]);
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    const createdAt = toIsoString(row.created_at);
    const document = toDocument(row.document);
    if (createdAt === null || typeof document !== "object" || document === null) {
      return null;
    }
    const parsed = SavedPlanSchema.safeParse({ ...document, id: row.id, createdAt });
    return parsed.success ? parsed.data : null;
  }
}
