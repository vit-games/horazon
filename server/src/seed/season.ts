import { readFile } from 'node:fs/promises';
import { pool } from '../db.js';
import { stackItem } from '../ingest.js';
import { getSeasons } from '../seasons.js';

/**
 * Two months of believable demo play for the sample character, at the start of the last finished
 * season (so it never mixes with the current one), to preview the charts over a season: play sessions with kill/map readings, drops (uniques, sets, runes, shards),
 * trade listings that sold or didn't, and manual sales. Everything is sample data:
 * `deleteSampleData` removes it (drops source 'sample', listings `sample-*`, manual sales
 * flagged `sample`, stat readings of the sample characters).
 */
const CHARACTER = 'Blizzy';
const DAYS = 60;
const HOUR = 3600e3;

type Template = { name: string; base_code: string; quality: { name: string } } & Record<string, unknown>;

export async function seedSampleSeason() {
  const { rows: had } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM listings WHERE id LIKE 'sample-%'`);
  if (had[0].n > 0) return { skipped: 'a sample season already exists - delete sample data first' };

  let seed = 20261001;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const poisson = (mean: number) => {
    let n = 0;
    for (let p = Math.exp(-mean), s = rand(); s > p; s *= rand()) n++;
    return n;
  };

  // Unique/set looks: the real finds plus the bundled sample drops.
  const { rows: real } = await pool.query<{ item: Template }>(`SELECT DISTINCT ON (name) item FROM drops WHERE quality IN ('Unique', 'Set')`);
  const bundled: { item: Template }[] = JSON.parse(await readFile(new URL('./sample-drops.json', import.meta.url), 'utf8'));
  const templates = [...real.map((r) => r.item), ...bundled.map((b) => b.item)].filter((i) => ['Unique', 'Set'].includes(i.quality.name));
  const uniques = templates.filter((t) => t.quality.name === 'Unique');
  const sets = templates.filter((t) => t.quality.name === 'Set');
  const season = (await getSeasons()).filter((x) => x.end).at(-1);
  if (!season) return { skipped: 'no finished season to put the sample data in' };

  const shard = () => ({ ...stackItem('rkey', 1), name: 'Worldstone Shard', base_code: 'wss', base: { id: 'wss', name: 'Worldstone Shard', category: 'misc', type: 'Worldstone Shard', type_code: 'misc', size: { width: 1, height: 1 } } });
  const rune = () => {
    const r = rand();
    // Low runes are common, mids uncommon, highs rare (Vex+ about once a week).
    const n = r < 0.86 ? 1 + Math.floor(rand() * 14) : r < 0.993 ? 15 + Math.floor(rand() * 11) : 26 + Math.floor(rand() ** 2 * 8);
    return stackItem(`r${String(n).padStart(2, '0')}`, 1);
  };

  const client = await pool.connect();
  const counts = { sessions: 0, drops: 0, readings: 0, listings: 0, manual: 0 };
  try {
    await client.query('BEGIN');
    const start = new Date(season.start);
    const now = Math.min(start.getTime() + DAYS * 24 * HOUR, new Date(season.end!).getTime()); // end of the demo
    start.setHours(0, 0, 0, 0); // sessions are placed by hour of day
    let kills = 384_120;
    let maps = 1_640;
    let deaths = 52;
    let itemId = 9_100_000_000_000;
    let listingN = 0;

    for (let day = start.getTime(); day < now; day += 24 * HOUR) {
      const weekend = [0, 6].includes(new Date(day).getDay());
      if (rand() > (weekend ? 0.9 : 0.72)) continue;
      const sessions = weekend && rand() < 0.5 ? 2 : 1;
      for (let s = 0; s < sessions; s++) {
        const from = day + (s === 0 && weekend ? 12 + rand() * 3 : 18 + rand() * 2.5) * HOUR;
        const hours = 1.2 + rand() * 3;
        const to = Math.min(from + hours * HOUR, now);
        if (from >= now) continue;
        counts.sessions++;

        for (let t = from; t <= to; t += 15 * 60e3) {
          kills += Math.round(15 * (45 + rand() * 30));
          maps += Math.round(rand() * 3);
          if (rand() < 0.03) deaths++;
          for (const [stat, value] of [['monster_kills', kills], ['map_boss_kills', maps], ['deaths', deaths]] as const) {
            await client.query('INSERT INTO stat_samples (observed_at, character, stat, value) VALUES ($1, $2, $3, $4)', [new Date(t), CHARACTER, stat, value]);
            counts.readings++;
          }
        }

        const span = to - from;
        const found: { item: Record<string, unknown>; at: number }[] = [];
        const add = (item: Record<string, unknown>) => found.push({ item, at: from + rand() * span });
        for (let i = poisson(2.6 * hours); i > 0; i--) add({ ...pick(uniques), id: ++itemId });
        for (let i = poisson(0.45 * hours); i > 0 && sets.length; i--) add({ ...pick(sets), id: ++itemId });
        for (let i = poisson(7 * hours); i > 0; i--) add(rune());
        for (let i = poisson(0.9 * hours); i > 0; i--) add(shard());

        for (const { item, at } of found) {
          const quality = (item.quality as { name: string }).name;
          const single = quality === 'Unique' || quality === 'Set';
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO drops (found_at, game_item_id, character, name, base_code, quality, quantity, item, source, stashed_at)
             VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 'sample', $8) RETURNING id`,
            [new Date(at), single ? item.id : null, CHARACTER, item.name, item.base_code, quality, item, single ? new Date(at + 2 * HOUR) : null],
          );
          counts.drops++;

          // About a third of the uniques/sets go up for sale; most of those sell, after some haggling.
          if (!single || rand() > 0.32) continue;
          const listed = at + (0.5 + rand() * 10) * HOUR;
          const closed = listed + (0.1 + rand() * 3.5) * 24 * HOUR;
          if (closed > now) continue;
          const asking = Math.max(0.05, Number((Math.exp(-1 + rand() * 2) * (1.1 + rand() * 0.6)).toFixed(2)));
          const sold = rand() < 0.84;
          const soldHr = sold ? Number((asking * (0.55 + rand() * 0.45)).toFixed(2)) : null;
          await client.query(
            `INSERT INTO listings (id, drop_id, item, name, base_code, quality, ladder, hardcore, asking, asking_hr,
                                   listed_at, last_seen, removed_at, outcome, sold_hr, sold_price, closed_at)
             VALUES ($1, $2, $3, $4, $5, $6, true, false, $7, $8, $9, $10, $10, $11, $12, $13, $10)`,
            [
              `sample-${++listingN}`, rows[0].id, item, item.name, item.base_code, quality, 'c/o', asking,
              new Date(listed), new Date(closed), sold ? 'sold' : 'unsold', soldHr, sold ? pick(['Ist + Gul', 'Vex', 'Ohm', 'Lo', '50 wss', 'Mal + Ist', 'Gul']) : null,
            ],
          );
          counts.listings++;
        }
      }

      // A couple of manual sales a week: uber mats, keys, runes, carries.
      if (rand() < 0.3) {
        const at = new Date(day + (19 + rand() * 3) * HOUR);
        if (at.getTime() < now) {
          const [items, hr, note] = pick<[{ code: string; qty: number }[], number, string | null]>([
            [[{ code: 'dhn', qty: 1 }, { code: 'bey', qty: 1 }, { code: 'mbr', qty: 1 }], 1.2 + rand() * 0.8, 'Organ set'],
            [[{ code: 'pk1', qty: 3 }, { code: 'pk2', qty: 3 }, { code: 'pk3', qty: 3 }], 0.8 + rand() * 0.7, null],
            [[{ code: 'r30', qty: 1 }], 2.6 + rand() * 0.6, null],
            [[{ code: 'r31', qty: 1 }], 1.3 + rand() * 0.4, null],
            [[], 0.5 + rand() * 1.2, 'Uber Tristram carry'],
            [[], 1.5 + rand() * 2, 'Lilith kill'],
          ]);
          await client.query('INSERT INTO manual_sales (sold_at, items, sold_hr, note, sample) VALUES ($1, $2, $3, $4, true)', [at, JSON.stringify(items), Number(hr.toFixed(2)), note]);
          counts.manual++;
        }
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { season: season.name, ...counts };
}
