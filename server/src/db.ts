import { readdir, readFile } from 'node:fs/promises';
import type pg from 'pg';

// Without a folder PGlite would keep everything in memory and lose it on exit.
if (!process.env.PGLITE_DIR) throw new Error('PGLITE_DIR (the database folder) is not set');

/** The embedded PGlite database, used through a pg-style `pool.query` / `pool.connect` API. */
export const pool = await pglitePool(process.env.PGLITE_DIR);

/**
 * PGlite behind the subset of pg.Pool this app uses. Values come back as pg returns them
 * (int8 as string, bytea as Buffer). PGlite has a single connection, so a checked-out
 * client holds it exclusively until release(): pool queries wait instead of landing in
 * the client's transaction.
 */
async function pglitePool(dataDir: string): Promise<pg.Pool> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  const db = await PGlite.create(dataDir, {
    parsers: {
      [types.INT8]: (x: string) => x,
      [types.BYTEA]: (x: string) => Buffer.from(x.slice(2), 'hex'),
    },
  });
  // A server's defaults keep up to 1 GB of transaction log; this is a small local database.
  // (Applies from the next start; ALTER SYSTEM can't run in a transaction, so one at a time.)
  await db.exec(`ALTER SYSTEM SET min_wal_size = '32MB'`);
  await db.exec(`ALTER SYSTEM SET max_wal_size = '64MB'`);

  let held: Promise<void> = Promise.resolve();
  const lock = async () => {
    let release!: () => void;
    const prev = held;
    held = new Promise((r) => (release = r));
    await prev;
    return release;
  };
  const run = (text: string, params?: unknown[]) => db.query(text, params);

  const pool = {
    async query(text: string, params?: unknown[]) {
      const release = await lock();
      try {
        return await run(text, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await lock();
      // exec: multi-statement SQL (migrations), which PGlite's query() doesn't take.
      return { query: run, exec: (sql: string) => db.exec(sql), release };
    },
    async end() {
      await lock();
      await db.close();
    },
  };
  return pool as unknown as pg.Pool;
}

/**
 * PGlite runs Postgres without its background workers: no autovacuum to reclaim dead
 * rows (snapshot rewrites, kill counter updates) and no checkpointer to recycle the
 * transaction log. Do both hourly.
 */
export function startMaintenance() {
  const run = () =>
    void (async () => {
      await pool.query('VACUUM');
      await pool.query('CHECKPOINT');
    })().catch((err) => console.error('database maintenance failed:', err));
  setTimeout(run, 5 * 60_000);
  setInterval(run, 3600_000);
}

const SQL_DIR = new URL('./sql/', import.meta.url);

/** The migration files shipped with this version, in order (pre-release ones left in an old build or install aside). */
export async function migrationFiles() {
  return (await readdir(SQL_DIR)).filter((f) => f.endsWith('.sql') && !PRE_RELEASE.includes(f)).sort();
}

const MIGRATIONS_TABLE = 'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())';

/** Run one migration file and record it, on a client inside a transaction. */
export async function applyMigration(client: pg.PoolClient, file: string) {
  const sql = await readFile(new URL(LEGACY.includes(file) ? `legacy/${file}` : file, SQL_DIR), 'utf8');
  await client.query(MIGRATIONS_TABLE);
  // Migration files hold several statements, which PGlite's query() doesn't take.
  await (client as unknown as { exec: (sql: string) => Promise<unknown> }).exec(sql);
  await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
}

export class SchemaMismatchError extends Error {}

/**
 * The pre-release migrations, squashed into 001_schema.sql. A database (or backup) that ran
 * all of them has exactly that schema; one that stopped earlier (beta.2 and before) can't be
 * opened any more.
 */
const PRE_RELEASE = [
  'init', 'stats', 'ingest', 'log_tail', 'item_updates', 'capture', 'capture_drops', 'zones', 'corruption', 'event_data',
  'listings', 'listing_hr', 'drop_review', 'manual_sales', 'sample_sales', 'run_progress', 'map_boss', 'map_stats',
  'treasure_fallen', 'invaders', 'character_info', 'unidentified_drops', 'drop_pins', 'ten_pin_slots', 'drop_market_cache',
  'slams', 'slam_items', 'slam_items_backfill', 'craft_names', 'slam_craft_names',
].map((name, i) => `${String(i + 1).padStart(3, '0')}_${name}.sql`);
const SQUASHED = '001_schema.sql';

/**
 * The beta migrations (0.1.0-beta.N), merged into 001_horazon.sql for the first public release; the
 * files stay in sql/legacy/ for upgrades. A beta database (or backup) runs the ones it lacks, then
 * is recorded as the merged file.
 */
export const LEGACY = [
  SQUASHED, '002_game_ladder.sql', '003_drop_kept.sql', '004_drop_discarded.sql', '005_boss_runs.sql', '006_game_xp.sql', '007_unsold_stashed.sql',
];
const MERGED = '001_horazon.sql';

/** What a database (or backup) with this history still has to run, in order: the legacy steps a beta lacks, then this version's files. */
export function stepsAfter(history: string[], files: string[]): string[] {
  const beta = history.some((m) => LEGACY.includes(m));
  return [...(beta ? LEGACY.filter((m) => !history.includes(m)) : []), ...files.filter((f) => !history.includes(f) && !(beta && f === MERGED))];
}

/** Once a beta's legacy steps have run: the merged file stands in for them (no-op otherwise). */
export async function recordMerged(client: Pick<pg.PoolClient, 'query'>) {
  await client.query(
    'WITH old AS (DELETE FROM schema_migrations WHERE name = ANY($1) RETURNING 1) INSERT INTO schema_migrations (name) SELECT $2::text WHERE EXISTS (SELECT 1 FROM old)',
    [LEGACY, MERGED],
  );
}

/** A migration history in terms of today's files: the full pre-release one becomes 001_schema.sql. */
export function currentHistory(applied: string[]): string[] {
  const old = applied.filter((m) => PRE_RELEASE.includes(m));
  if (!old.length) return applied;
  if (old.length < PRE_RELEASE.length) throw new SchemaMismatchError('is from a pre-release build, which this version can no longer read');
  return [SQUASHED, ...applied.filter((m) => !PRE_RELEASE.includes(m))].sort();
}

/**
 * Migrations this version still has to apply to the database. Throws when the database
 * has migrations this version doesn't know: it was opened by a newer version, and an
 * older one must not write to it. A full pre-release history is rewritten as 001_schema.sql.
 */
export async function pendingMigrations() {
  await pool.query(MIGRATIONS_TABLE);
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  let history: string[];
  try {
    history = currentHistory(rows.map((r) => r.name));
  } catch (err) {
    throw new SchemaMismatchError(`the database ${(err as Error).message}; move or delete it to start fresh`);
  }
  if (rows.some((r) => PRE_RELEASE.includes(r.name))) {
    await pool.query('WITH old AS (DELETE FROM schema_migrations WHERE name = ANY($1)) INSERT INTO schema_migrations (name) VALUES ($2)', [PRE_RELEASE, SQUASHED]);
    console.log(`migration history: pre-release migrations recorded as ${SQUASHED}`);
  }
  const files = await migrationFiles();
  const unknown = history.filter((m) => !files.includes(m) && !LEGACY.includes(m));
  if (unknown.length) {
    throw new SchemaMismatchError(`the database was used by a newer version of the app (${unknown.sort().join(', ')}); install that version or newer`);
  }
  return { pending: stepsAfter(history, files), fresh: history.length === 0 };
}

/** Apply src/sql/NNN_*.sql files that haven't run yet, in order (a beta database's legacy steps first). */
export async function migrate() {
  const { pending } = await pendingMigrations();

  for (const file of pending) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await applyMigration(client, file);
      await client.query('COMMIT');
      console.log(`migration applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  await recordMerged(pool);
}
