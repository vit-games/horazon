import { pool } from './db.js';
import { notify } from './events.js';
import { resolveMapRuns } from './capture.js';
import { isKeptDrop } from './gamedata.js';
import { ApiError, fetchCharacter, fetchStash, type ApiItem, type CharacterResponse } from './pd2api.js';
import { SAMPLE_CHARACTERS } from './seed/seed.js';
import { getSettings, updateSettings } from './settings.js';

const RUNES = [
  'El', 'Eld', 'Tir', 'Nef', 'Eth', 'Ith', 'Tal', 'Ral', 'Ort', 'Thul', 'Amn',
  'Sol', 'Shael', 'Dol', 'Hel', 'Io', 'Lum', 'Ko', 'Fal', 'Lem', 'Pul', 'Um',
  'Mal', 'Ist', 'Gul', 'Vex', 'Ohm', 'Lo', 'Sur', 'Ber', 'Jah', 'Cham', 'Zod',
];
// Flawless / perfect gems only (the grades the shared stash currency tab stores).
const GEMS: Record<string, { flawless: string; perfect: string; name: string }> = {
  amethyst: { flawless: 'gzv', perfect: 'gpv', name: 'Amethyst' },
  topaz: { flawless: 'gly', perfect: 'gpy', name: 'Topaz' },
  sapphire: { flawless: 'glb', perfect: 'gpb', name: 'Sapphire' },
  emerald: { flawless: 'glg', perfect: 'gpg', name: 'Emerald' },
  ruby: { flawless: 'glr', perfect: 'gpr', name: 'Ruby' },
  diamond: { flawless: 'glw', perfect: 'gpw', name: 'Diamond' },
  skull: { flawless: 'skl', perfect: 'skz', name: 'Skull' },
};
// Id-less misc items worth tracking (rare uber drops). The
// shared stash keeps Puzzleboxes and Demonic Cubes as counts in its currency tab.
const MISC_STACKS: [string, string][] = [
  ['lbox', "Larzuk's Puzzlebox"],
  ['rkey', 'Skeleton Key'],
  ['imrn', 'Demonic Cube'],
];
const CURRENCY_MISC: Record<string, string> = { puzzlebox: 'lbox', demonic_cube: 'imrn' };

export const STACK_NAMES = new Map<string, { name: string; kind: 'Rune' | 'Gem' | 'Misc' }>([
  ...MISC_STACKS.map(([code, name]) => [code, { name, kind: 'Misc' as const }] as const),
  ...RUNES.map((r, i) => [`r${String(i + 1).padStart(2, '0')}`, { name: `${r} Rune`, kind: 'Rune' as const }] as const),
  ...Object.values(GEMS).flatMap((g) => [
    [g.flawless, { name: `Flawless ${g.name}`, kind: 'Gem' as const }] as const,
    [g.perfect, { name: g.name === 'Skull' ? 'Perfect Skull' : `Perfect ${g.name}`, kind: 'Gem' as const }] as const,
  ]),
]);

/** Increases in rune/gem totals must persist this long before they count as drops. */
const STACK_SETTLE_MS = 10 * 60e3;

interface Snapshot {
  key: string;
  character: string | null;
  savedAt: Date | null;
  items: ApiItem[];
  /** Loose runes/gems (inventory, stash, currency tab) - what "owned" means. */
  stacks: Record<string, number>;
  /** Runes/gems sitting in sockets: counted for drop detection only, so socketing a
   *  fresh rune before the next save still registers as a drop. */
  socketed: Record<string, number>;
  raw: unknown;
}

let status: { running: boolean; lastCycle: Date | null } = { running: false, lastCycle: null };

/**
 * PD2 keeps a shared stash per mode. Each mode an enabled character plays in is its own source:
 * `stash:acct` (ladder softcore, the usual one) and `stash:acct:nonladder`, `:hardcore` or
 * `:nonladder-hardcore`, so a ladder and a non-ladder character never swap one snapshot for the other.
 */
type Mode = { ladder: boolean; hardcore: boolean };
const LADDER_SOFTCORE: Mode = { ladder: true, hardcore: false };
const modeSuffix = ({ ladder, hardcore }: Mode) =>
  ladder && !hardcore ? '' : `:${[ladder ? '' : 'nonladder', hardcore ? 'hardcore' : ''].filter(Boolean).join('-')}`;
const modeOfKey = (key: string): Mode => {
  const suffix = key.split(':')[2] ?? '';
  return { ladder: !suffix.includes('nonladder'), hardcore: suffix.includes('hardcore') };
};

/** The mode of the shared stash holding `itemId` (for listing it), null when no stash holds it. */
export async function stashModeOf(itemId: number): Promise<Mode | null> {
  const { rows } = await pool.query<{ key: string; snapshot: { raw?: { items?: ApiItem[] } } | null }>(
    "SELECT key, snapshot FROM sources WHERE key LIKE 'stash:%'",
  );
  const hit = rows.find((r) => r.snapshot?.raw?.items?.some((i) => i.id === itemId));
  return hit ? modeOfKey(hit.key) : null;
}
export const ingestStatus = () => status;

/** "r30s" (PD2 rune stack) -> "r30"; null for anything that isn't a tracked stackable. */
export function stackCodeOf(baseCode: string): string | null {
  if (STACK_NAMES.has(baseCode)) return baseCode;
  // PD2 stacks of runes/gems carry an "s" suffix (r30s, glbs).
  const code = baseCode.endsWith('s') ? baseCode.slice(0, -1) : null;
  return code && STACK_NAMES.has(code) ? code : null;
}
const stackCode = (item: ApiItem) => stackCodeOf(item.base_code);

function isTrackedUnique(item: ApiItem) {
  return !item.is_simple && item.id > 0;
}

/** Items inside sockets (jewels keep their own ids there). */
const socketedChildren = (items: ApiItem[]) => items.flatMap((i) => i.socketed ?? []);

function countStacks(items: ApiItem[], into: Record<string, number> = {}) {
  for (const item of items) {
    if (isTrackedUnique(item)) continue; // items with an id are tracked by id, never as a count
    const code = stackCode(item);
    if (code) into[code] = (into[code] ?? 0) + (typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1);
  }
  return into;
}

function characterSnapshot(name: string, res: CharacterResponse): Snapshot {
  const items = [...res.items, ...(res.mercenary?.items ?? [])];
  return {
    key: `character:${name}`,
    character: name,
    savedAt: res.file?.updated_at ? new Date(res.file.updated_at * 1000) : null,
    items,
    stacks: countStacks(items),
    socketed: countStacks(socketedChildren(items)),
    raw: res,
  };
}

/** Synthesized item JSON for a rune/gem drop, shaped like an API item. */
export function stackItem(code: string, quantity: number) {
  const info = STACK_NAMES.get(code)!;
  return {
    id: 0,
    name: info.name,
    base_code: code,
    quantity,
    quality: { id: 2, name: 'Normal' },
    base: {
      id: code,
      name: info.name,
      category: 'misc',
      type: info.kind === 'Misc' ? info.name : info.kind,
      type_code: info.kind === 'Rune' ? 'rune' : info.kind === 'Gem' ? 'gem' : 'misc',
      size: { width: 1, height: 1 },
    },
    is_identified: true,
    is_ethereal: false,
    is_simple: true,
    is_runeword: false,
    corrupted: false,
    socket_count: 0,
    graphic_id: false,
    modifiers: [],
  };
}

async function insertDrop(foundAt: Date, source: string, character: string | null, item: ApiItem | ReturnType<typeof stackItem>) {
  if (!isKeptDrop(item.base_code, item.quality?.name)) return;
  await pool.query(
    `INSERT INTO drops (found_at, game_item_id, character, name, base_code, quality, quantity, item, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      foundAt,
      item.id || null,
      character,
      item.name,
      item.base_code,
      item.quality?.name ?? 'Normal',
      typeof item.quantity === 'number' ? item.quantity : 1,
      item,
      source,
    ],
  );
}

export type Mod = { name: string; values?: number[] };
/** A property with its rolled values, to compare items across sources. */
export const modKey = (m: Mod) => `${m.name}:${(m.values ?? []).join(',')}`;

/**
 * The game capture lists drops as they happen; when the API reports the same item
 * later, it completes that row (id, full item) instead of adding another drop.
 */
async function matchCaptureDrop(item: ApiItem): Promise<boolean> {
  const { rows } = await pool.query<{ id: string; name: string; mods: Mod[] | null; crafted_from: unknown }>(
    `SELECT id, name, item->'modifiers' AS mods, item->'crafted_from' AS crafted_from FROM drops
      WHERE source IN ('capture', 'craft') AND matched_at IS NULL AND base_code = $1 AND quality = $2
        AND found_at > now() - interval '3 days'
      ORDER BY found_at LIMIT 50`,
    [item.base_code, item.quality?.name ?? 'Normal'],
  );
  // Several drops can share a base (unique rings...): prefer the same name, then the row
  // whose captured properties have the API item's values, then the oldest.
  const apiMods = new Set(((item.modifiers ?? []) as Mod[]).map(modKey));
  const score = (r: (typeof rows)[number]) => (r.name === item.name ? 1000 : 0) + (r.mods ?? []).filter((m) => apiMods.has(modKey(m))).length;
  const best = rows.reduce<(typeof rows)[number] | undefined>((a, r) => (!a || score(r) > score(a) ? r : a), undefined);
  if (!best) return false;
  // A craft keeps what went into it.
  const full = best.crafted_from ? { ...item, crafted_from: best.crafted_from } : item;
  await pool.query('UPDATE drops SET game_item_id = $2, name = $3, item = $4, matched_at = now() WHERE id = $1', [
    best.id,
    item.id,
    item.name,
    full,
  ]);
  return true;
}

/** Rune/gem increases the capture already listed: mark up to `quantity` of them matched, return the rest. */
async function matchCaptureStacks(code: string, quantity: number, since: Date): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE drops SET matched_at = now()
      WHERE id IN (SELECT id FROM drops
                    WHERE source = 'capture' AND matched_at IS NULL AND base_code = $1
                      AND found_at > $2::timestamptz - interval '2 hours'
                    ORDER BY found_at LIMIT $3)
      RETURNING id`,
    [code, since, quantity],
  );
  return quantity - rows.length;
}

/**
 * Once the game capture has recorded games, it decides what counts as a drop (items
 * found outside town in a captured game); the API only completes those rows.
 */
async function captureActive(): Promise<boolean> {
  const { rows } = await pool.query<{ active: boolean }>('SELECT EXISTS (SELECT 1 FROM games) AS active');
  return rows[0].active;
}

/** Record ids for one source; returns number of new drops. */
async function diffIds(snap: Snapshot, baseline: boolean, attributeTo: string | null, items = [...snap.items, ...socketedChildren(snap.items)]): Promise<number> {
  const withIds = items.filter(isTrackedUnique);
  const ids = withIds.map((i) => i.id);
  const { rows } = await pool.query<{ item_id: string }>('SELECT item_id FROM seen_items WHERE item_id = ANY($1::bigint[])', [ids]);
  const seen = new Set(rows.map((r) => Number(r.item_id)));

  let drops = 0;
  const captured = !baseline && (await captureActive());
  for (const item of withIds) {
    if (seen.has(item.id)) continue;
    // Unidentified finds are recorded once identified (they may be vendored unseen);
    // anything already owned when tracking starts is baseline either way.
    if (!baseline && item.is_identified === false) continue;
    seen.add(item.id);
    await pool.query('INSERT INTO seen_items (item_id, source) VALUES ($1, $2) ON CONFLICT DO NOTHING', [item.id, snap.key]);
    // Owned when tracking starts: only remembered as seen. It doesn't count for the grail; the
    // player marks their earlier finds on the Grail tab.
    if (baseline) continue;
    if (await matchCaptureDrop(item)) {
      drops++;
    } else if (!captured) {
      await insertDrop(snap.savedAt ?? new Date(), snap.key.split(':')[0], snap.character ?? attributeTo, item);
      drops++;
    }
  }
  return drops;
}

/** Content fingerprint: the API's hash when present, else the fields a slam/socketing changes. */
const fingerprint = (i: ApiItem) =>
  typeof i.hash === 'string' && i.hash
    ? i.hash
    : JSON.stringify([i.name, i.quality?.name, i.corrupted, i.socket_count, (i.modifiers as { label: string }[] | undefined)?.map((m) => m.label)]);

/**
 * Keep recorded drops in sync with the items they became: a corrupted (slammed) or
 * socketed item keeps its id, so update the drop to the current version and keep
 * the as-dropped one in `original_item`. Returns how many drops changed.
 */
async function syncDropItems(snap: Snapshot): Promise<number> {
  const byId = new Map([...snap.items, ...socketedChildren(snap.items)].filter(isTrackedUnique).map((i) => [String(i.id), i]));
  if (!byId.size) return 0;
  const { rows } = await pool.query<{ id: number; game_item_id: string; item: ApiItem }>(
    'SELECT id, game_item_id::text, item FROM drops WHERE game_item_id = ANY($1::bigint[])',
    [[...byId.keys()]],
  );
  let updated = 0;
  for (const row of rows) {
    const current = byId.get(row.game_item_id);
    if (!current || fingerprint(current) === fingerprint(row.item)) continue;
    await pool.query(
      `UPDATE drops SET original_item = COALESCE(original_item, item), item = $2, item_updated_at = now() WHERE id = $1`,
      [row.id, current],
    );
    updated++;
  }
  return updated;
}

/**
 * Compare global rune/gem totals with the committed totals. A rise becomes a drop
 * once it has held for STACK_SETTLE_MS (moves between sources cancel out first).
 */
async function diffStacks(totals: Record<string, number>, rebaseline: boolean, attributeTo: string | null): Promise<number> {
  const { rows } = await pool.query<{ code: string; committed: number; pending_since: Date | null; pending_min: number | null }>(
    'SELECT code, committed, pending_since, pending_min FROM stack_counts',
  );
  const state = new Map(rows.map((r) => [r.code, r]));
  const codes = new Set([...Object.keys(totals), ...state.keys()]);
  const now = new Date();
  let drops = 0;
  const captured = await captureActive();

  for (const code of codes) {
    const current = totals[code] ?? 0;
    const row = state.get(code);
    const save = (committed: number, since: Date | null, min: number | null) =>
      pool.query(
        `INSERT INTO stack_counts (code, committed, pending_since, pending_min) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET committed = $2, pending_since = $3, pending_min = $4`,
        [code, committed, since, min],
      );

    if (!row || rebaseline || current <= row.committed) {
      if (!row || row.committed !== current || row.pending_since) await save(current, null, null);
      continue;
    }
    if (!row.pending_since) {
      await save(row.committed, now, current);
      continue;
    }
    const min = Math.min(row.pending_min ?? current, current);
    if (now.getTime() - row.pending_since.getTime() < STACK_SETTLE_MS) {
      await save(row.committed, row.pending_since, min);
      continue;
    }
    const unseen = await matchCaptureStacks(code, min - row.committed, row.pending_since);
    if (unseen > 0 && !captured) await insertDrop(row.pending_since, 'stack', attributeTo, stackItem(code, unseen));
    drops++;
    await save(min, current > min ? now : null, current > min ? current : null);
  }
  return drops;
}

async function saveSource(key: string, fields: { snapshot?: unknown; savedAt?: Date | null; error?: string | null; baseline?: boolean }) {
  await pool.query(
    `INSERT INTO sources (key, last_poll_at, last_error, snapshot, game_saved_at, baseline_at)
     VALUES ($1, now(), $2, $3, $4, CASE WHEN $5 THEN now() END)
     ON CONFLICT (key) DO UPDATE SET
       last_poll_at = now(),
       last_error = $2,
       -- An unchanged snapshot (~1 MB for a full stash, polled every minute) keeps the stored
       -- value instead of writing a new copy each time.
       snapshot = CASE WHEN $3::jsonb IS NULL OR $3::jsonb = sources.snapshot THEN sources.snapshot ELSE $3::jsonb END,
       game_saved_at = COALESCE($4, sources.game_saved_at),
       baseline_at = COALESCE(sources.baseline_at, CASE WHEN $5 THEN now() END)`,
    [key, fields.error ?? null, fields.snapshot ? JSON.stringify(fields.snapshot) : null, fields.savedAt ?? null, fields.baseline ?? false],
  );
}

/** Characters of captured games are the player's own: start tracking them automatically. */
async function discoverCharacters() {
  const settings = await getSettings();
  const { rows } = await pool.query<{ character: string }>('SELECT DISTINCT character FROM games WHERE character IS NOT NULL');
  const found = rows.map((r) => r.character).filter((c) => !SAMPLE_CHARACTERS.includes(c) && !(c in settings.characters));
  if (found.length) {
    await updateSettings({ characters: { ...settings.characters, ...Object.fromEntries(found.map((c) => [c, true])) } });
  }
}

export async function pollOnce() {
  if (status.running) return;
  status.running = true;
  try {
    await discoverCharacters();
    const settings = await getSettings();
    const enabled = Object.entries(settings.characters).filter(([, on]) => on).map(([name]) => name);
    const activeKeys = new Set(enabled.map((c) => `character:${c}`));
    const stashKey = settings.token ? `stash:${settings.account ?? 'pending'}` : null;

    // Sources that were switched off drop out of the totals; re-enabling takes a fresh baseline.
    // The account's stashes of every mode stay (a mode not played lately still holds its items).
    await pool.query(`DELETE FROM sources WHERE NOT (key = ANY($1::text[]) OR key = $2 OR key LIKE $2 || ':%')`, [[...activeKeys], stashKey]);
    const { rows: known } = await pool.query<{ key: string; baseline_at: Date | null; game_saved_at: Date | null; snapshot: Snapshot | null }>(
      'SELECT key, baseline_at, game_saved_at, snapshot FROM sources',
    );
    const byKey = new Map(known.map((r) => [r.key, r]));

    const fresh: Snapshot[] = [];
    const modes = new Map<string, Mode>();
    for (const name of enabled) {
      const key = `character:${name}`;
      try {
        const res = await fetchCharacter(name);
        const mode = { ladder: res.character.status.is_ladder, hardcore: res.character.status.is_hardcore };
        modes.set(modeSuffix(mode), mode);
        fresh.push(characterSnapshot(name, res));
      } catch (err) {
        const msg = err instanceof ApiError && err.status === 404 ? 'Character not found' : String((err as Error).message ?? err);
        await saveSource(key, { error: msg });
      }
    }
    if (!modes.size) modes.set('', LADDER_SOFTCORE);
    for (const [suffix, mode] of settings.token ? modes : []) {
      const current = await getSettings();
      let key = `stash:${current.account ?? 'pending'}${suffix}`;
      try {
        const { stash: res, account, refreshedToken } = await fetchStash(current.account, current.token!, mode.ladder, mode.hardcore);
        // The session login tells us the account name and may re-issue the token.
        if ((account && account !== current.account) || refreshedToken) {
          await updateSettings({ ...(account ? { account } : {}), ...(refreshedToken ? { token: refreshedToken } : {}) });
          if (account) key = `stash:${account}${suffix}`;
        }
        const stacks = countStacks(res.items ?? []);
        for (const [n, count] of Object.entries(res.currency?.runes ?? {})) {
          if (STACK_NAMES.has(n) && count > 0) stacks[n] = (stacks[n] ?? 0) + count;
        }
        for (const [field, code] of Object.entries(CURRENCY_MISC)) {
          const count = Number((res.currency as Record<string, unknown> | undefined)?.[field] ?? 0);
          if (count > 0) stacks[code] = (stacks[code] ?? 0) + count;
        }
        for (const [grade, gems] of Object.entries(res.currency?.gems ?? {}) as ['flawless' | 'perfect', Record<string, number>][]) {
          for (const [gem, count] of Object.entries(gems ?? {})) {
            const code = GEMS[gem]?.[grade];
            if (code && count > 0) stacks[code] = (stacks[code] ?? 0) + count;
          }
        }
        fresh.push({
          key,
          character: null,
          savedAt: res.file?.updated_at ? new Date(res.file.updated_at * 1000) : null,
          items: res.items ?? [],
          stacks,
          socketed: countStacks(socketedChildren(res.items ?? [])),
          raw: { file: res.file, currency: res.currency, items: res.items },
        });
      } catch (err) {
        const msg = err instanceof ApiError && err.status === 401 ? 'Token rejected (401) - paste a new token' : String((err as Error).message ?? err);
        await saveSource(key, { error: msg });
      }
    }

    // Shared-stash drops are credited to whichever character saved most recently.
    const lastActive = [...fresh, ...known.map((k) => ({ key: k.key, savedAt: k.game_saved_at }))]
      .filter((s) => s.key.startsWith('character:') && s.savedAt)
      .sort((a, b) => b.savedAt!.getTime() - a.savedAt!.getTime())[0]?.key.slice('character:'.length) ?? null;

    let drops = 0;
    let changedItems = 0;
    let rebaseline = false;
    for (const snap of fresh) {
      const prev = byKey.get(snap.key);
      const baseline = !prev?.baseline_at;
      // Snapshots stored before socket tracking existed: whatever is already in sockets
      // was owned before, so record it as baseline instead of reporting it as new drops.
      const upgrading = !baseline && !!prev?.snapshot && !('socketed' in prev.snapshot);
      rebaseline ||= baseline || upgrading;
      if (upgrading) await diffIds(snap, true, lastActive, socketedChildren(snap.items));
      const unchanged =
        !baseline && !upgrading && prev?.game_saved_at && snap.savedAt && prev.game_saved_at.getTime() === snap.savedAt.getTime();
      if (!unchanged) {
        drops += await diffIds(snap, baseline, lastActive);
        changedItems += await syncDropItems(snap);
      }
      await saveSource(snap.key, {
        snapshot: { stacks: snap.stacks, socketed: snap.socketed, raw: snap.raw },
        savedAt: snap.savedAt,
        baseline,
      });
    }

    // Totals over the latest snapshot of every active source (fresh or last good one).
    const { rows: all } = await pool.query<{ snapshot: Partial<Pick<Snapshot, 'stacks' | 'socketed'>> | null }>('SELECT snapshot FROM sources');
    const totals: Record<string, number> = {};
    for (const { snapshot } of all) {
      for (const counts of [snapshot?.stacks, snapshot?.socketed]) {
        for (const [code, n] of Object.entries(counts ?? {})) totals[code] = (totals[code] ?? 0) + n;
      }
    }
    drops += await diffStacks(totals, rebaseline, lastActive);
    if (fresh.length) await resolveMapRuns();

    status.lastCycle = new Date();
    notify('sources');
    if (drops || changedItems) {
      console.log(`ingest: ${drops} new drop(s), ${changedItems} updated item(s)`);
      notify('drops');
    }
  } catch (err) {
    console.error('ingest cycle failed', err);
  } finally {
    status.running = false;
  }
}

/** Current loose rune/gem holdings across all sources (socketed runes are spent, not owned). */
/** Ids of every item in the latest snapshot of each source (stash, characters), socketed ones too. */
/** Every item id held in the last synced stashes and characters, with where it is now. */
export async function heldItems(): Promise<Map<string, unknown>> {
  const { rows } = await pool.query<{ snapshot: { raw?: { items?: ApiItem[]; mercenary?: { items?: ApiItem[] } } } | null }>('SELECT snapshot FROM sources');
  const held = new Map<string, unknown>();
  for (const { snapshot } of rows) {
    const items = [...(snapshot?.raw?.items ?? []), ...(snapshot?.raw?.mercenary?.items ?? [])];
    for (const i of [...items, ...socketedChildren(items)]) if (i.id) held.set(String(i.id), i.location ?? null);
  }
  return held;
}

export async function holdings(): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ snapshot: { stacks?: Record<string, number> } | null }>('SELECT snapshot FROM sources');
  const totals: Record<string, number> = {};
  for (const { snapshot } of rows) {
    for (const [code, n] of Object.entries(snapshot?.stacks ?? {})) totals[code] = (totals[code] ?? 0) + n;
  }
  return totals;
}

export function startIngest() {
  const loop = async () => {
    await pollOnce();
    const { pollSeconds } = await getSettings().catch(() => ({ pollSeconds: 60 }));
    setTimeout(loop, Math.max(20, pollSeconds) * 1000);
  };
  void loop();
}
