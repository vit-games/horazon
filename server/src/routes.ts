import type { FastifyInstance } from 'fastify';
import { lookUpMissing } from './characters.js';
import { pool } from './db.js';
import { notify } from './events.js';
import { heldItems, holdings, ingestStatus, pollOnce } from './ingest.js';
import {
  addManualSale,
  closeListing,
  deleteManualSale,
  deleteListingRecord,
  updateManualSale,
  getManualSales,
  getListings,
  listingSyncStatus,
  postDrop,
  syncListings,
} from './listings.js';
import { seedSampleSeason } from './seed/season.js';
import { deleteSampleData } from './seed/seed.js';
import { getSeasons } from './seasons.js';
import { NON_LADDER_CHARACTERS } from './ladder.js';
import { getSettings, parseTierConfig, updateSettings, type Settings } from './settings.js';
import { getValues } from './values.js';

type RangeQuery = { since?: string; until?: string };

/** Expiry from a JWT's `exp` claim (not verified - only used to warn in the UI). */
function jwtExpiry(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

async function queryDrops({ since, until }: RangeQuery, includeIgnored: boolean) {
  const { rows } = await pool.query(
    `SELECT id, found_at, character, quantity, item, source, ignored, kept, original_item, item_updated_at, stashed_at, pin_slot, pinned_at
       FROM drops
      WHERE ($1::timestamptz IS NULL OR found_at >= $1)
        AND ($2::timestamptz IS NULL OR found_at < $2)
        AND ($3 OR NOT ignored)
        -- A season's drops are the ladder characters'.
        AND ($1::timestamptz IS NULL OR character IS NULL OR character NOT IN ${NON_LADDER_CHARACTERS})
      ORDER BY found_at DESC
      LIMIT 20000`,
    [since ?? null, until ?? null, includeIgnored],
  );
  return rows;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

/**
 * Every character seen anywhere, most recently played first, with class and level when known
 * and ladder status (that of its latest game whose flags were captured; null if none was).
 */
async function listCharacters() {
  const { rows: characters } = await pool.query<{ name: string; class: string | null }>(
    `SELECT c.character AS name, sum(samples)::int AS samples, sum(drops)::int AS drops, max(last_seen) AS last_seen,
            min(i.class) AS class, min(i.level) AS level,
            (SELECT g.ladder FROM games g WHERE g.character = c.character AND g.ladder IS NOT NULL ORDER BY g.started_at DESC LIMIT 1) AS ladder
       FROM (SELECT character, count(*) AS samples, 0 AS drops, max(observed_at) AS last_seen
               FROM stat_samples GROUP BY character
             UNION ALL
             SELECT character, 0, count(*), max(found_at) FROM drops
              WHERE character IS NOT NULL AND NOT ignored GROUP BY character
             UNION ALL
             SELECT character, 0, 0, max(last_event_at) FROM games WHERE character IS NOT NULL GROUP BY character) c
       LEFT JOIN character_info i ON i.name = c.character
      GROUP BY c.character
      ORDER BY max(last_seen) DESC`,
  );
  lookUpMissing(characters.filter((c) => !c.class).map((c) => c.name));
  return characters;
}

export function registerRoutes(app: FastifyInstance) {
  app.get<{ Querystring: RangeQuery & { ignored?: string } }>('/api/drops', async (req) => ({
    drops: await queryDrops(req.query, req.query.ignored === 'include'),
  }));

  // pinSlot: pin to haul card 0-9 (null unpins); unpin: drops that held that slot (in the page's range).
  // Slams in the range (on any item, newest first): the item before and after, bricked or not.
  app.get<{ Querystring: RangeQuery }>('/api/slams', async (req) => {
    const { rows } = await pool.query<{ bricked: boolean }>(
      // Slams on your finds show the find's item before and after; others what the capture stored.
      `SELECT s.id, s.at, s.character, s.code, s.before_quality, s.after_quality, s.bricked, s.drop_id,
              -- A find's own row is the most complete (the stash sync adds what the capture can't see).
              COALESCE(d.original_item, s.before_item, d.item) AS before_item, COALESCE(d.item, s.after_item) AS after_item
         FROM slams s LEFT JOIN drops d ON d.id = s.drop_id
        WHERE ($1::timestamptz IS NULL OR s.at >= $1) AND ($2::timestamptz IS NULL OR s.at < $2)
        ORDER BY s.at DESC`,
      [req.query.since ?? null, req.query.until ?? null],
    );
    return { slams: rows.length, bricked: rows.filter((r) => r.bricked).length, list: rows };
  });

  // Items you still hold, in your stash or on a character now (matched to the API item, so they can
  // be listed for sale): magic, rare and crafted finds, and stashed drops of any kind - the Trade tab's
  // lists. A stashed item you sold or dropped in game leaves with the next sync.
  app.get('/api/stash-finds', async () => {
    const held = await heldItems();
    const { rows } = await pool.query(
      `SELECT id, found_at, character, quantity, item, source, ignored, kept, original_item, item_updated_at, stashed_at, pin_slot, pinned_at,
              game_item_id::text AS game_item_id
         FROM drops
        WHERE (COALESCE(item->'quality'->>'name', quality) IN ('Magic', 'Rare', 'Crafted') OR stashed_at IS NOT NULL)
          AND NOT ignored AND game_item_id IS NOT NULL
        ORDER BY found_at DESC`,
    );
    // The drop's item keeps where it was when last changed; moving it doesn't, so take today's location.
    return {
      drops: rows
        .filter((r) => held.has(r.game_item_id))
        .map(({ game_item_id, ...r }) => ({ ...r, item: { ...r.item, location: held.get(game_item_id) ?? r.item.location } })),
    };
  });

  app.patch<{ Params: { id: string }; Body: { ignored?: boolean; kept?: boolean; stashed?: boolean; pinSlot?: number | null; unpin?: number[] } }>('/api/drops/:id', async (req, reply) => {
    const { ignored, kept, stashed, pinSlot, unpin } = req.body ?? {};
    if (pinSlot !== undefined && pinSlot !== null && !(Number.isInteger(pinSlot) && pinSlot >= 0 && pinSlot < 10)) return reply.code(400).send({ error: 'bad pin slot' });
    // Hiding a drop also unpins it: a pin on a hidden drop would hold a haul card nobody can see.
    if (typeof ignored === 'boolean')
      await pool.query(
        'UPDATE drops SET ignored = $2, pin_slot = CASE WHEN $2 THEN NULL ELSE pin_slot END, pinned_at = CASE WHEN $2 THEN NULL ELSE pinned_at END WHERE id = $1',
        [req.params.id, ignored],
      );
    if (typeof kept === 'boolean') await pool.query('UPDATE drops SET kept = $2 WHERE id = $1', [req.params.id, kept]);
    if (typeof stashed === 'boolean') await pool.query('UPDATE drops SET stashed_at = CASE WHEN $2 THEN now() END WHERE id = $1', [req.params.id, stashed]);
    if (Array.isArray(unpin) && unpin.length) {
      await pool.query('UPDATE drops SET pin_slot = NULL, pinned_at = NULL WHERE id = ANY($1::bigint[])', [unpin.map(Number).filter(Number.isInteger)]);
    }
    if (pinSlot !== undefined) {
      await pool.query('UPDATE drops SET pin_slot = $2, pinned_at = CASE WHEN $2::smallint IS NULL THEN NULL ELSE now() END WHERE id = $1', [req.params.id, pinSlot]);
    }
    notify('drops');
    return { ok: true };
  });

  // Stat readings for one character (all time; the UI slices by range so deltas
  // can reach back before the range start), plus every character seen anywhere,
  // most recently played first (the default selection).
  app.get('/api/characters', async () => ({ characters: await listCharacters() }));

  // Stat readings of one character (default: the first), or of every character (all=1).
  app.get<{ Querystring: { character?: string; all?: string } }>('/api/stats', async (req) => {
    const characters = await listCharacters();
    const all = req.query.all === '1';
    const character = all ? null : req.query.character ?? characters[0]?.name;
    const { rows: samples } =
      all || character
        ? await pool.query(
            `SELECT observed_at AS t, character, stat, value::float8 AS value, approximate
               FROM stat_samples WHERE $1::text IS NULL OR character = $1 ORDER BY observed_at, id`,
            [character],
          )
        : { rows: [] };
    return { character: character ?? null, characters, samples };
  });

  // Grail: first time each unique/set was found within the range - only finds the capture saw in
  // a game (a stash pull doesn't decide), plus the player's own marks (`baseline`), which win over
  // later drops. `drop_id` marks the drop that was the new find.
  app.get<{ Querystring: RangeQuery }>('/api/grail', async (req) => {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (quality, name) quality, name, found_at, baseline, drop_id, item
         FROM (SELECT quality, name, found_at, false AS baseline, id AS drop_id, COALESCE(original_item, item) AS item FROM drops
                WHERE quality IN ('Unique', 'Set') AND source = 'capture' AND (NOT ignored OR discarded)
                  -- A season's grail is the ladder characters'.
                  AND ($1::timestamptz IS NULL OR character IS NULL OR character NOT IN ${NON_LADDER_CHARACTERS})
               UNION ALL
               SELECT quality, name, marked_at, true, NULL, NULL FROM grail_marks) f
        WHERE ($1::timestamptz IS NULL OR found_at >= $1) AND ($2::timestamptz IS NULL OR found_at < $2)
        ORDER BY quality, name, baseline DESC, found_at`,
      [req.query.since ?? null, req.query.until ?? null],
    );
    return { found: rows };
  });

  app.put<{ Body: { quality: string; name: string; found: boolean } }>('/api/grail/mark', async (req, reply) => {
    const { quality, name, found } = req.body ?? {};
    if ((quality !== 'Unique' && quality !== 'Set') || typeof name !== 'string' || !name) return reply.code(400).send({ error: 'bad item' });
    if (found) await pool.query('INSERT INTO grail_marks (quality, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [quality, name]);
    else await pool.query('DELETE FROM grail_marks WHERE quality = $1 AND name = $2', [quality, name]);
    notify('drops');
    return { ok: true };
  });

  app.get('/api/settings', async () => {
    const s = await getSettings();
    return {
      account: s.account,
      characters: s.characters,
      pollSeconds: s.pollSeconds,
      autoBackupKeep: s.autoBackupKeep,
      hasToken: !!s.token,
      tokenHint: s.token ? `…${s.token.slice(-6)}` : null,
      tokenExpires: s.token ? jwtExpiry(s.token) : null,
    };
  });

  app.put<{ Body: Partial<Settings> }>('/api/settings', async (req) => {
    const patch: Partial<Settings> = {};
    const b = req.body ?? {};
    // Accept the raw localStorage value too: strip quotes and a "Bearer " prefix.
    if (typeof b.token === 'string') patch.token = b.token.trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '') || null;
    if (typeof b.account === 'string') patch.account = b.account.trim() || null;
    if (b.characters && typeof b.characters === 'object') patch.characters = b.characters;
    if (typeof b.pollSeconds === 'number') patch.pollSeconds = Math.min(600, Math.max(20, b.pollSeconds));
    if (typeof b.autoBackupKeep === 'number') patch.autoBackupKeep = Math.min(90, Math.max(0, Math.round(b.autoBackupKeep)));
    await updateSettings(patch);
    void pollOnce();
    return { ok: true };
  });

  app.get('/api/sources', async () => {
    const { rows } = await pool.query(
      'SELECT key, baseline_at, game_saved_at, last_poll_at, last_error FROM sources ORDER BY key',
    );
    const { lastCycle, running } = ingestStatus();
    return { sources: rows, lastCycle, running };
  });

  app.post('/api/poll', async () => {
    await pollOnce();
    return { ok: true };
  });

  app.get('/api/values', () => getValues());

  // Item tiers (body {tiers: config}, or {tiers: null} for the built-in default).
  app.put<{ Body: { tiers?: unknown } }>('/api/tiers', async (req, reply) => {
    const raw = req.body?.tiers;
    const tiers = raw === null ? null : parseTierConfig(raw);
    if (raw !== null && !tiers) return reply.code(400).send({ error: 'Invalid tier list' });
    await updateSettings({ tiers });
    notify('values');
    return { ok: true };
  });

  app.get('/api/listings', async () => ({ listings: await getListings(), manualSales: await getManualSales(), sync: listingSyncStatus() }));

  type ManualSaleBody = { Body: { items: { code: string; qty: number }[]; soldHr: number; note?: string } };
  // Shared by add and edit: null when the body is unusable.
  const manualSaleArgs = (body: ManualSaleBody['Body'] | undefined) => {
    const { soldHr, note } = body ?? {};
    const items = (body?.items ?? []).filter((i) => typeof i.code === 'string' && Number.isInteger(i.qty) && i.qty > 0);
    if ((!items.length && !note?.trim()) || !(typeof soldHr === 'number' && soldHr >= 0)) return null;
    return [items.map(({ code, qty }) => ({ code, qty })), soldHr, note?.trim() || null] as const;
  };
  const badManualSale = { error: 'needs currencies or a description, and an HR price' };
  app.post<ManualSaleBody>('/api/manual-sales', async (req, reply) => {
    const args = manualSaleArgs(req.body);
    if (!args) return reply.code(400).send(badManualSale);
    await addManualSale(...args);
    return { ok: true };
  });
  app.put<ManualSaleBody & { Params: { id: string } }>('/api/manual-sales/:id', async (req, reply) => {
    const args = manualSaleArgs(req.body);
    if (!args) return reply.code(400).send(badManualSale);
    await updateManualSale(req.params.id, ...args);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/manual-sales/:id', async (req) => {
    await deleteManualSale(req.params.id);
    return { ok: true };
  });
  app.post('/api/listings/sync', async () => {
    await syncListings();
    return { ok: true };
  });
  app.post<{ Body: { dropId: number | string; hrPrice: number; note?: string } }>('/api/listings', async (req, reply) => {
    const { hrPrice, note } = req.body ?? {};
    const dropId = Number(req.body?.dropId); // bigint ids reach the client as strings
    if (!Number.isInteger(dropId) || !(typeof hrPrice === 'number' && hrPrice >= 0)) return reply.code(400).send({ error: 'needs a drop and an HR price' });
    try {
      return { id: await postDrop(dropId, hrPrice, note?.trim() ?? '') };
    } catch (err) {
      return reply.code(502).send({ error: String((err as Error).message ?? err) });
    }
  });
  app.patch<{ Params: { id: string }; Body: { outcome: 'sold' | 'unsold' | null; soldHr?: number; soldPrice?: string; delist?: boolean } }>(
    '/api/listings/:id',
    async (req, reply) => {
      const { outcome, soldHr, soldPrice, delist } = req.body ?? {};
      if (outcome !== null && outcome !== 'sold' && outcome !== 'unsold') return reply.code(400).send({ error: 'bad outcome' });
      if (outcome === 'sold' && !(typeof soldHr === 'number' && soldHr >= 0)) return reply.code(400).send({ error: 'sold needs an HR price' });
      try {
        await closeListing(req.params.id, outcome, soldHr ?? null, soldPrice?.trim() || null, delist === true && outcome !== null);
      } catch (err) {
        return reply.code(502).send({ error: String((err as Error).message ?? err) });
      }
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/listings/:id', async (req) => {
    await deleteListingRecord(req.params.id);
    return { ok: true };
  });

  app.get('/api/holdings', async () => ({ holdings: await holdings() }));
  app.get('/api/seasons', async () => ({ seasons: await getSeasons() }));

  app.post('/api/sample-data/season', async () => {
    const result = await seedSampleSeason();
    notify('drops');
    notify('stats');
    notify('listings');
    return result;
  });

  app.delete('/api/sample-data', async () => {
    await deleteSampleData();
    notify('drops');
    notify('stats');
    notify('listings');
    return { ok: true };
  });

  app.get<{ Querystring: RangeQuery }>('/api/export/drops.json', async (req, reply) => {
    reply.header('content-disposition', 'attachment; filename="pd2-drops.json"');
    return { exportedAt: new Date(), drops: await queryDrops(req.query, false) };
  });

  app.get<{ Querystring: RangeQuery }>('/api/export/drops.csv', async (req, reply) => {
    const drops = await queryDrops(req.query, false);
    const rows = drops.map((d) => [
      d.found_at, d.character, d.item.name, d.item.quality?.name, d.item.base?.name, d.item.base_code, d.quantity,
      d.item.is_ethereal ? 'yes' : '', d.item.socket_count || '', d.item.corrupted ? 'yes' : '', d.source,
      (d.item.modifiers ?? []).map((m: { label: string }) => m.label).join(' | '),
    ]);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="pd2-drops.csv"');
    return toCsv(['found_at', 'character', 'name', 'quality', 'base', 'base_code', 'quantity', 'ethereal', 'sockets', 'corrupted', 'source', 'modifiers'], rows);
  });

  app.get<{ Querystring: RangeQuery }>('/api/export/stats.csv', async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT observed_at, character, stat, value, approximate FROM stat_samples
        WHERE ($1::timestamptz IS NULL OR observed_at >= $1) AND ($2::timestamptz IS NULL OR observed_at < $2)
        ORDER BY observed_at, id`,
      [req.query.since ?? null, req.query.until ?? null],
    );
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="pd2-stats.csv"');
    return toCsv(['observed_at', 'character', 'stat', 'value', 'approximate'], rows.map((r) => [r.observed_at, r.character, r.stat, r.value, r.approximate]));
  });
}
