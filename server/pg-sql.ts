import { Pool, type PoolConfig } from "pg";

/**
 * The one place that talks to PostgreSQL. A thin, Neon-shaped layer over a `pg` Pool so the rest of
 * the code (`sql\`...${value}\``, awaited rows, `sql.transaction([...])`) is unchanged:
 *  - values are always sent as bind parameters ($1, $2, ...), never interpolated into the text;
 *  - a query is lazy: it only runs when awaited (or when handed to `sql.transaction`);
 *  - the result is an array of row objects (same pg type parsers the Neon driver used);
 *  - `sql.transaction([...])` runs the statements in order inside BEGIN/COMMIT on one connection and
 *    returns one row array per statement; any failure rolls everything back.
 *
 * Environment: DATABASE_URL (postgres://user:pass@host:port/db[?sslmode=...]).
 *  - TLS: `sslmode=disable` turns it off; `verify-full`/`verify-ca` verify the certificate; anything else
 *    (`require`, `prefer`, `no-verify`, or no sslmode at all on a remote host) encrypts without verifying,
 *    which is what Railway's public proxy (self-signed certificate) needs. localhost and *.railway.internal
 *    default to plain TCP.
 *  - DATABASE_POOL_MAX: connections per server instance (default 5; keep instances x max below the
 *    database's max_connections).
 */
// Query results are untyped rows, like the Neon driver's default result.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export interface SqlQuery extends PromiseLike<Row[]> {
  readonly text: string;
  readonly values: readonly unknown[];
  catch<R = never>(onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<Row[] | R>;
  finally(onfinally?: (() => void) | null): Promise<Row[]>;
}

export interface Sql {
  (parts: TemplateStringsArray, ...values: unknown[]): SqlQuery;
  transaction(queries: readonly SqlQuery[]): Promise<Row[][]>;
  end(): Promise<void>;
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|.*\.railway\.internal)$/i;

export function sslFor(connectionString: string): PoolConfig["ssl"] {
  const mode = /[?&]sslmode=([^&#]*)/i.exec(connectionString)?.[1]?.toLowerCase();
  if (mode === "disable") return false;
  if (mode === "verify-full" || mode === "verify-ca") return { rejectUnauthorized: true };
  if (mode) return { rejectUnauthorized: false };
  let host = "";
  try { host = new URL(connectionString).hostname; } catch { /* malformed URL: let pg report it */ }
  return LOCAL_HOST.test(host) ? false : { rejectUnauthorized: false };
}

function poolConfig(connectionString: string): PoolConfig {
  const max = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  return {
    // `sslmode` is handled by sslFor(): pg would otherwise read `require` as full certificate verification.
    connectionString: connectionString.replace(/([?&])sslmode=[^&#]*&?/i, "$1").replace(/[?&]$/, ""),
    ssl: sslFor(connectionString),
    max: Number.isFinite(max) && max > 0 ? max : 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    application_name: "honto",
  };
}

function lazyQuery(pool: Pool, text: string, values: unknown[]): SqlQuery {
  let promise: Promise<Row[]> | null = null;
  const run = () => (promise ??= pool.query(text, values).then((result) => result.rows as Row[]));
  return {
    text,
    values,
    then: (onfulfilled, onrejected) => run().then(onfulfilled, onrejected),
    catch: (onrejected) => run().catch(onrejected),
    finally: (onfinally) => run().finally(onfinally),
  };
}

async function runTransaction(pool: Pool, queries: readonly SqlQuery[]): Promise<Row[][]> {
  if (!queries.length) return [];
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    const results: Row[][] = [];
    for (const query of queries) results.push((await client.query(query.text, [...query.values])).rows as Row[]);
    await client.query("COMMIT");
    return results;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { broken = true; }
    throw error;
  } finally {
    client.release(broken);
  }
}

function build(connectionString: string): Sql {
  const pool = new Pool(poolConfig(connectionString));
  // An idle connection dropped by the server must not crash the process; the pool discards it.
  pool.on("error", (error) => console.error("[db] idle client error:", error.message));
  const sql = ((parts: TemplateStringsArray, ...values: unknown[]) =>
    lazyQuery(pool, parts.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)) as Sql;
  sql.transaction = (queries) => runTransaction(pool, queries);
  sql.end = () => pool.end();
  return sql;
}

type Registry = Map<string, Sql>;
const registry = ((globalThis as { __hontoSql?: Registry }).__hontoSql ??= new Map());

/**
 * One shared client (and pool) per connection string for the whole process, reused across requests
 * and hot reloads. Every module gets the same instance, so per-client memoization (schema checks) is shared.
 */
export function createSql(connectionString: string): Sql {
  let sql = registry.get(connectionString);
  if (!sql) registry.set(connectionString, (sql = build(connectionString)));
  return sql;
}
