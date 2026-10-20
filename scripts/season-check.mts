/**
 * Season rollover check: migrations apply on a fresh database, runs keep the tier they were
 * played at, and a ladder character moved to non-ladder at the reset still counts for its season.
 *   npx tsx scripts/season-check.mts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { nonLadderCharacters } from '../server/src/ladder.ts';

const db = new PGlite();
const sqlDir = new URL('../server/src/sql/', import.meta.url);
const migrations = readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();
const migrate = async (files: string[]) => {
  for (const f of files) await db.exec(readFileSync(new URL(f, sqlDir), 'utf8'));
};
const tierAt = migrations.indexOf('004_map_tier.sql');
await migrate(migrations.slice(0, tierAt));

// Season 1 runs until T; Old played ladder in it and non-ladder after; New only after.
const T = '2026-02-01T00:00:00Z';
await db.exec(`INSERT INTO games (id, character, started_at, last_event_at, ladder) VALUES
  ('a', 'Old', '2026-01-10', '2026-01-10', true),
  ('b', 'Old', '2026-02-10', '2026-02-10', false),
  ('c', 'New', '2026-02-11', '2026-02-11', true)`);
const excluded = async (until: string | null) =>
  (await db.query<{ character: string }>(`SELECT character FROM ${nonLadderCharacters('$1')} x`, [until])).rows.map((r) => r.character);
assert.deepEqual(await excluded(T), [], 'Old counts for the season it played ladder in');
assert.deepEqual(await excluded(null), ['Old'], 'Old is left out of the current season');

// Runs from before the tier column get the tiers frozen in 004 (Bastion Keep: T3).
await db.exec(`INSERT INTO map_runs (game_id, kind, map_code, area, started_at) VALUES ('a', 'map', 't13', 1, '2026-01-10')`);
await migrate(migrations.slice(tierAt));
assert.equal((await db.query<{ map_tier: string }>('SELECT map_tier FROM map_runs')).rows[0].map_tier, 'T3');

await db.close();
console.log('season check ok');
