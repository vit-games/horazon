import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { LEGACY, applyMigration, currentHistory, migrationFiles, pool, recordMerged, stepsAfter } from './db.js';
import { dataReplaced } from './events.js';
import { getSettings, updateSettings } from './settings.js';

/**
 * Database backups: gzipped JSON lines, one header line then one line per table
 * ({"table": name, "rows": [...]}). Rows are produced by json_agg and read back with
 * json_populate_recordset, so the same file restores into a newer PGlite, and a
 * backup from an older version restores by replaying the newer migrations after it.
 */

export const BACKUP_DIR = process.env.BACKUP_DIR ?? path.resolve(process.cwd(), 'backups');
const FORMAT = 'horazon-backup';
/** Backups from before the rename (the app was called Hellforge): same contents. */
const LEGACY_FORMAT = 'hellforge-backup';

/** update: taken before an update is installed and before new migrations run. */
export type BackupKind = 'manual' | 'auto' | 'safety' | 'update' | 'imported';
/** How many of each kind are kept; older ones are deleted after a new one is written. */
const KEEP: Partial<Record<BackupKind, number>> = { safety: 5, update: 5 };
const AUTO_EVERY_MS = 24 * 3600_000;

interface Header {
  format: typeof FORMAT | typeof LEGACY_FORMAT;
  version: 1;
  createdAt: string;
  migrations: string[];
  tables: Record<string, number>;
}

export interface BackupInfo {
  name: string;
  kind: BackupKind;
  size: number;
  createdAt: string;
}

const NAME = /^(?:horazon|hellforge)-(manual|auto|safety|update|imported)-(\d{8}-\d{6})(?:-\d+)?\.json\.gz$/;

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** User tables in an order that satisfies their foreign keys (parents first). */
async function tablesInOrder(db: Pick<pg.PoolClient, 'query'>) {
  const { rows: tables } = await db.query<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY 1`,
  );
  const { rows: fks } = await db.query<{ child: string; parent: string }>(
    `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
       FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f' AND n.nspname = 'public' AND c.conrelid <> c.confrelid`,
  );
  const ordered: string[] = [];
  const visit = (t: string, seen = new Set<string>()) => {
    if (ordered.includes(t) || seen.has(t)) return;
    seen.add(t);
    for (const fk of fks) if (fk.child === t) visit(fk.parent, seen);
    ordered.push(t);
  };
  for (const t of tables) visit(t.name);
  return ordered;
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function writeBackup(kind: BackupKind, data: Buffer) {
  await mkdir(BACKUP_DIR, { recursive: true });
  let name = `horazon-${kind}-${stamp()}.json.gz`;
  for (let i = 2; await stat(path.join(BACKUP_DIR, name)).then(() => true, () => false); i++) {
    name = `horazon-${kind}-${stamp()}-${i}.json.gz`;
  }
  const file = path.join(BACKUP_DIR, name);
  await writeFile(`${file}.tmp`, data);
  await rename(`${file}.tmp`, file);
  await prune(kind);
  return name;
}

/** Write a backup of the whole database to the backup folder. */
export async function createBackup(kind: BackupKind = 'manual') {
  // One client for a consistent snapshot of all tables.
  const client = await pool.connect();
  const lines: string[] = [];
  const counts: Record<string, number> = {};
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const { rows: migrations } = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    for (const table of await tablesInOrder(client)) {
      const { rows } = await client.query<{ rows: string; n: number }>(
        `SELECT COALESCE(json_agg(t), '[]')::text AS rows, count(*)::int AS n FROM ${ident(table)} t`,
      );
      counts[table] = rows[0].n;
      // json_agg separates rows with newlines (never inside strings): one table per line.
      lines.push(`{"table":${JSON.stringify(table)},"rows":${rows[0].rows.replace(/\n/g, '')}}`);
    }
    await client.query('COMMIT');
    const header: Header = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), migrations: migrations.map((m) => m.name), tables: counts };
    lines.unshift(JSON.stringify(header));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const name = await writeBackup(kind, gzipSync(lines.join('\n')));
  console.log(`backup written: ${name}`);
  return name;
}

function parseBackup(data: Buffer) {
  let text: string;
  try {
    text = gunzipSync(data).toString('utf8');
  } catch {
    throw new BackupError('not a Horazon backup (not gzip)');
  }
  const [first, ...rest] = text.split('\n');
  let header: Header;
  try {
    header = JSON.parse(first);
  } catch {
    throw new BackupError('not a Horazon backup');
  }
  if ((header?.format !== FORMAT && header?.format !== LEGACY_FORMAT) || header.version !== 1) throw new BackupError('not a Horazon backup');
  try {
    header.migrations = currentHistory(header.migrations);
  } catch (err) {
    throw new BackupError(`backup ${(err as Error).message}`);
  }
  return { header, tables: rest.map((line) => JSON.parse(line) as { table: string; rows: unknown[] }) };
}

export class BackupError extends Error {}

/** Check an uploaded backup and store it in the backup folder. */
export async function importBackup(data: Buffer) {
  const { header } = parseBackup(data);
  await checkMigrations(header);
  return writeBackup('imported', data);
}

async function checkMigrations(header: Header) {
  const local = await migrationFiles();
  const unknown = header.migrations.filter((m) => !local.includes(m) && !LEGACY.includes(m));
  if (unknown.length) throw new BackupError(`backup is from a newer Horazon version (${unknown.join(', ')})`);
  // A beta backup's history is a start of the legacy list; anything newer, of this version's files.
  const expected = header.migrations.some((m) => LEGACY.includes(m)) ? LEGACY : local;
  const missing = expected.slice(0, header.migrations.length).some((m, i) => m !== header.migrations[i]);
  if (missing) throw new BackupError('backup has an unexpected migration history');
}

/**
 * Replace the whole database with a backup. A safety backup of the current data is
 * written first. Runs in one transaction: on any error nothing changes.
 */
export async function restoreBackup(name: string) {
  const { header, tables } = parseBackup(await readFile(backupPath(name)));
  await checkMigrations(header);
  const safety = await createBackup('safety');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Recreate the schema as of the backup, load the rows, then apply newer migrations.
    const { rows: existing } = await client.query<{ name: string }>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`);
    if (existing.length) await client.query(`DROP TABLE ${existing.map((t) => ident(t.name)).join(', ')} CASCADE`);
    for (const file of header.migrations) await applyMigration(client, file);

    const order = await tablesInOrder(client);
    if (order.length) await client.query(`TRUNCATE ${order.map(ident).join(', ')} RESTART IDENTITY CASCADE`);
    const byTable = new Map(tables.map((t) => [t.table, t.rows]));
    // json_populate_recordset reads a JSON null as SQL NULL: a required jsonb column (a setting
    // saved as null, like a cleared token) gets its JSON null back instead of failing the restore.
    const { rows: required } = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'jsonb' AND is_nullable = 'NO'`,
    );
    for (const table of order) {
      const rows = byTable.get(table);
      if (!rows?.length) continue;
      const fix = required.filter((c) => c.table_name === table).map((c) => c.column_name);
      const cols = fix.length
        ? (await client.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
            [table],
          )).rows.map(({ column_name: c }) => (fix.includes(c) ? `COALESCE(p.${ident(c)}, 'null'::jsonb)` : `p.${ident(c)}`)).join(', ')
        : 'p.*';
      await client.query(`INSERT INTO ${ident(table)} SELECT ${cols} FROM json_populate_recordset(NULL::${ident(table)}, $1::json) p`, [
        JSON.stringify(rows),
      ]);
    }

    // Serial columns continue after the restored ids.
    const { rows: serials } = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'`,
    );
    for (const { table_name: t, column_name: c } of serials) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT max(${ident(c)}) FROM ${ident(t)}), 0) + 1, false)`,
        [ident(t), c],
      );
    }

    for (const file of stepsAfter(header.migrations, await migrationFiles())) await applyMigration(client, file);
    await recordMerged(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  dataReplaced();
  console.log(`backup restored: ${name} (previous data saved as ${safety})`);
  return { restored: name, safety, tables: header.tables };
}

export function backupPath(name: string) {
  if (!NAME.test(name)) throw new BackupError('invalid backup name');
  return path.join(BACKUP_DIR, name);
}

export async function listBackups(): Promise<BackupInfo[]> {
  const names = await readdir(BACKUP_DIR).catch(() => [] as string[]);
  const list = await Promise.all(
    names
      .filter((n) => NAME.test(n))
      .map(async (name) => {
        const s = await stat(path.join(BACKUP_DIR, name));
        return { name, kind: NAME.exec(name)![1] as BackupKind, size: s.size, createdAt: s.mtime.toISOString() };
      }),
  );
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteBackup(name: string) {
  await rm(backupPath(name));
}

async function prune(kind: BackupKind) {
  const keep = kind === 'auto' ? (await getSettings()).autoBackupKeep : KEEP[kind];
  if (!keep) return;
  const old = (await listBackups()).filter((b) => b.kind === kind).slice(keep);
  for (const b of old) await deleteBackup(b.name);
}

/** Daily automatic backups (kept: settings.autoBackupKeep, 0 = off). */
export function startAutoBackup() {
  const check = async () => {
    if (!(await getSettings()).autoBackupKeep) return;
    const last = (await listBackups()).find((b) => b.kind === 'auto');
    if (last && Date.now() - new Date(last.createdAt).getTime() < AUTO_EVERY_MS) return;
    await createBackup('auto');
  };
  const run = () => void check().catch((err) => console.error('auto backup failed:', err));
  setTimeout(run, 60_000); // not during startup
  setInterval(run, 3600_000);
}

/** Database size and rows per table. */
export async function databaseInfo() {
  const { rows: size } = await pool.query<{ bytes: string }>('SELECT pg_database_size(current_database()) AS bytes');
  const tables = [];
  for (const table of await tablesInOrder(pool)) {
    const { rows } = await pool.query<{ n: number; bytes: string }>(
      `SELECT count(*)::int AS n, pg_total_relation_size($1::regclass) AS bytes FROM ${ident(table)}`,
      [ident(table)],
    );
    tables.push({ name: table, rows: rows[0].n, bytes: Number(rows[0].bytes) });
  }
  return { bytes: Number(size[0].bytes), tables: tables.sort((a, b) => b.bytes - a.bytes), backupDir: BACKUP_DIR };
}

/** Reclaim space left by deleted and updated rows. */
export async function compactDatabase() {
  const before = (await databaseInfo()).bytes;
  await pool.query('VACUUM (FULL, ANALYZE)');
  return { before, after: (await databaseInfo()).bytes };
}

/** Characters found in the data, with how much each has. */
export async function characterData() {
  const { rows } = await pool.query<{ character: string; drops: number; stats: number; games: number }>(
    `SELECT character, sum(drops)::int AS drops, sum(stats)::int AS stats, sum(games)::int AS games FROM (
       SELECT character, count(*) AS drops, 0 AS stats, 0 AS games FROM drops WHERE character IS NOT NULL GROUP BY 1
       UNION ALL SELECT character, 0, count(*), 0 FROM stat_samples GROUP BY 1
       UNION ALL SELECT character, 0, 0, count(*) FROM games WHERE character IS NOT NULL GROUP BY 1
     ) x GROUP BY 1 ORDER BY 1`,
  );
  const { characters } = await getSettings();
  // tracked: on the character list; polled: on it and not paused.
  const all = new Map(rows.map((r) => [r.character, { ...r, tracked: r.character in characters, polled: characters[r.character] === true }]));
  for (const name of Object.keys(characters)) {
    if (!all.has(name)) all.set(name, { character: name, drops: 0, stats: 0, games: 0, tracked: true, polled: characters[name] === true });
  }
  return [...all.values()].sort((a, b) => a.character.localeCompare(b.character));
}

/**
 * Delete everything recorded for a character: drops, stat readings, captured games
 * (with their runs, visits, events and items) and its polling state. With `untrack`
 * it's also removed from the polled characters; otherwise its next poll is a new baseline.
 */
export async function deleteCharacter(name: string, untrack: boolean) {
  const safety = await createBackup('safety');
  const client = await pool.connect();
  const removed: Record<string, number> = {};
  try {
    await client.query('BEGIN');
    const source = `character:${name}`;
    removed.drops = (await client.query('DELETE FROM drops WHERE character = $1', [name])).rowCount ?? 0;
    removed.stats = (await client.query('DELETE FROM stat_samples WHERE character = $1', [name])).rowCount ?? 0;
    removed.games = (await client.query('DELETE FROM games WHERE character = $1', [name])).rowCount ?? 0;
    await client.query('DELETE FROM seen_items WHERE source = $1', [source]);
    await client.query('DELETE FROM sources WHERE key = $1', [source]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  if (untrack) {
    const { characters } = await getSettings();
    delete characters[name];
    await updateSettings({ characters });
  }
  dataReplaced();
  return { removed, safety };
}

export function registerBackupRoutes(app: FastifyInstance) {
  // Uploaded backups arrive as the raw file.
  app.addContentTypeParser(['application/gzip', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: 1024 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof BackupError) return reply.code(400).send({ error: err.message });
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send({ error: 'backup not found' });
    throw err;
  };

  app.get('/api/database', async () => ({ ...(await databaseInfo()), backups: await listBackups() }));
  app.post('/api/database/compact', () => compactDatabase());

  app.post<{ Querystring: { kind?: string } }>('/api/backups', async (req) => ({
    name: await createBackup(req.query.kind === 'update' ? 'update' : 'manual'),
  }));
  app.post<{ Body: Buffer }>('/api/backups/import', async (req, reply) => {
    try {
      return { name: await importBackup(req.body) };
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.get<{ Params: { name: string } }>('/api/backups/:name', async (req, reply) => {
    try {
      const data = await readFile(backupPath(req.params.name));
      return reply.type('application/gzip').header('content-disposition', `attachment; filename="${req.params.name}"`).send(data);
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.delete<{ Params: { name: string } }>('/api/backups/:name', async (req, reply) => {
    try {
      await deleteBackup(req.params.name);
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post<{ Params: { name: string } }>('/api/backups/:name/restore', async (req, reply) => {
    try {
      return await restoreBackup(req.params.name);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/data/characters', async () => ({ characters: await characterData() }));
  app.delete<{ Params: { name: string }; Querystring: { untrack?: string } }>('/api/data/characters/:name', (req) =>
    deleteCharacter(req.params.name, req.query.untrack === 'true'),
  );
}
