import type { FastifyInstance } from 'fastify';
import { createBackup } from './backup.js';
import { saveCharacterInfo } from './characters.js';
import { pool } from './db.js';
import { killRate, type Curve } from './killrate.js';
import { population, populationRuns } from './population.js';
import { notify, onDataReplaced } from './events.js';
import { areasNamed, baseInfo, isKeptDrop, setOrUniqueName } from './gamedata.js';
import { modKey, STACK_NAMES, stackCodeOf, stackItem } from './ingest.js';
import type { ApiItem } from './pd2api.js';

/**
 * Game sessions from the capture sidecar (capture/pd2capture.py). The sidecar decodes
 * the game connection and posts events; this turns them into games, area visits,
 * map runs (one per game, plus Horazon maps within it), map events and found items.
 */

interface ItemFields {
  code: string;
  quality?: string;
  ilvl?: number;
  uid?: number;
  ethereal?: boolean;
  /** Sockets (identified items that have any). */
  sockets?: number;
  /** Art variant (rings, amulets, jewels, charms). */
  graphic?: number;
  /** Pickups: whether the item was already identified (rare maps, runes, bases...). */
  identified?: boolean;
}

/** An item property decoded by the sidecar, in the PD2 API's modifier shape. */
interface ItemMod {
  name: string;
  label: string;
  values: number[];
  priority: number;
}

/** A found item with its properties when the sidecar could read them. */
type FoundItem = ItemFields & { mods?: ItemMod[] | null };

/** One of a map's properties, as decoded by the sidecar ("Monster Density: +126%"). */
export interface MapStat {
  stat: string;
  value: number;
  label: string;
}

type CaptureEvent = { game: string; ts: number } & (
  | { type: 'game_start'; server?: string; character?: string | null; charClass?: string | null }
  | { type: 'game_flags'; ladder: boolean }
  | { type: 'level'; level: number }
  | { type: 'xp'; xp: number; lost: number }
  | { type: 'mendeln_xp'; xp: number; total: number | null }
  | { type: 'map_event'; event: string; invader?: string }
  | { type: 'game_end' }
  | { type: 'area'; area: number }
  | { type: 'kills'; count: number | null; deaths?: number }
  | { type: 'notice'; text: string }
  | { type: 'portal'; area: number; unit: number }
  | { type: 'boss'; name: string; state: 'seen' | 'killed'; area: number | null }
  | ({ type: 'map_used'; mods?: MapStat[] | null } & ItemFields)
  | ({ type: 'uber_used'; area: number | null; name: string; tier: number; mods?: MapStat[] | null } & ItemFields)
  | { type: 'uber_killed'; area: number | null; name: string }
  | { type: 'uber_live'; name: string; bosses: Record<string, number> }
  | { type: 'uber_hp'; name: string; hp: number | null; bosses: Record<string, number>; phase: number | null }
  | { type: 'death'; area: number | null; killer: number | null; killerName: string | null }
  | ({ type: 'drop' } & ItemFields)
  | ({ type: 'pickup'; area?: number | null; unit?: number } & FoundItem)
  | ({ type: 'discarded'; unit: number; area?: number | null } & ItemFields)
  | ({ type: 'identified'; area?: number | null; droppedHere?: boolean; bought?: boolean; unit?: number } & FoundItem)
  | ({ type: 'shop_item' | 'shop_buy'; unit: number } & ItemFields)
  | ({ type: 'corrupted'; before: ItemFields & { mods: ItemMod[] | null }; mods: ItemMod[] } & ItemFields)
  | ({ type: 'crafted'; area?: number | null; inputs: { code: string; quality?: string | null }[] } & FoundItem)
);

/**
 * Map events (wiki.projectdiablo2.com/wiki/Maps) the capture can't tell by a monster or
 * object of theirs (map_event), matched on the notice's first words only - the game's
 * wording differs from the wiki's ("keeps the dark at bay"). Other events' notices are ignored.
 */
export const MAP_EVENTS: { kind: string; prefix: string }[] = [
  { kind: 'dark_wanderer', prefix: 'darkness itself' },
  { kind: 'spire', prefix: 'a faint humming' },
  // Gheed's shop tells him too; his notice keeps the ones whose shop wasn't opened.
  { kind: 'gheed', prefix: 'you hear coins' },
];
/** What a traced event's row keeps as its message: the monster or object that told it. */
const EVENT_NAMES: Record<string, string> = {
  mendeln: 'Shadow of Mendeln', horazon: 'Horazon',
  treasure_fallen: 'Treasure Fallen', catalyst_altar: 'Altar of the Catalyst',
};
/** Notices of events the capture reports as map_event: not the 'other' event either. */
const TRACED_NOTICES = ['evil beckons', 'an alternate dimension', 'shrieking', 'a shrieking', 'a mysterious altar', 'you feel a corrupted presence', 'corrupted '];

/**
 * What each event is known to drop, counted from the ground drops in its map after the
 * event's notice. Treasure Fallen drops ordinary loot, so only a short window after it
 * counts (an approximation: regular monsters drop in that window too).
 */
const MAP_ORBS = new Set(['imma', 'irma', 'imra', 'irra', 'upma', 'urma', 'scou', 'rera', 'rrra', 'upmp', 'scrb', 'fort']);
const EVENT_REWARDS: Record<string, { match: (code: string) => boolean; windowMs?: number }> = {
  spire: { match: (c) => c === 'pk1' || c === 'pk2' || c === 'pk3' },
  catalyst_altar: { match: (c) => c === 'iwss' },
  dark_wanderer: { match: (c) => c === 'wss' || c === 'cwss' },
  mendeln: { match: (c) => c === 'rtmv' },
  invaders: { match: (c) => /^ive[a-z]$/.test(c) },
  treasure_fallen: { match: (c) => /^r\d\ds?$/.test(c) || MAP_ORBS.has(c) || /^t[1-4][0-9a-z]$/.test(c), windowMs: 120_000 },
};

interface ShopItem extends ItemFields {
  unit: number;
  bought?: boolean;
  /** Filled in when a bought unique is identified. */
  name?: string;
}
interface EventData {
  drops?: Record<string, number>;
  shop?: ShopItem[];
  /** Time of the event's latest notice (ms): it repeats near each of its monsters (Treasure Fallen). */
  lastAt?: number;
  /** Shadow of Mendeln: experience from him and his undead, and the character's at the latest of it. */
  xp?: number;
  xpTotal?: number;
  /** Invaders: the class of each invader, in the order they turned hostile. */
  invaders?: string[];
}
interface ActiveEvent {
  id: number;
  kind: string;
  at: number;
  runId: number | null;
  data: EventData;
  dirty: boolean;
}

/** Town areas: Rogue Encampment, Lut Gholein, Kurast Docks, Pandemonium Fortress, Harrogath. */
const TOWNS = new Set([1, 40, 75, 103, 109]);
/** Diablo II's last area (levels.txt); PD2 map areas come after it. */
const LAST_D2_AREA = 136;
/**
 * Uber boss arenas (levels.txt) -> their encounter: boss runs, never maps or zones. Rathma's
 * three phases (Swamp, Jungle, Void) and Lucion's arena and vault are one fight each.
 */
const UBER_AREAS = new Map<number, string>([
  [136, 'Uber Tristram'], [185, 'Uber Tristram'], [137, 'Diablo Clone'], [162, 'Rathma'], [161, 'Rathma'], [163, 'Rathma'],
  [168, 'Uber Ancients'], [188, 'Lucion'], [189, 'Lucion'],
]);
/** "Corruption spreads in the Lost City, Ancient Tunnels, and Claw Viper Temple..." (game start, Hell). */
const CORRUPTION_NOTICE = /^Corruption spreads in (.+?)\.*$/;
/** Items that must be identified first are recorded on identification, the rest on pickup. */
const NEEDS_ID = new Set(['magic', 'rare', 'set', 'unique', 'crafted']);
const QUALITY_NAME: Record<string, string> = {
  inferior: 'Inferior', normal: 'Normal', superior: 'Superior', magic: 'Magic', set: 'Set', rare: 'Rare', unique: 'Unique', crafted: 'Crafted',
};
const QUALITY_ID: Record<string, number> = { inferior: 1, normal: 2, superior: 3, magic: 4, set: 5, rare: 6, unique: 7, crafted: 8 };

export function dropGroup(code: string, quality?: string): string {
  if (/^r\d\ds?$/.test(code)) return 'rune';
  if (code === 'wss' || code === 'cwss') return 'shard';
  if (/^t[1-6][0-9a-z]$/.test(code)) return 'map';
  if (quality && NEEDS_ID.has(quality)) return quality;
  return 'other';
}

interface Visit {
  id: number;
  area: number;
  runId: number | null;
  enteredAt: number;
  killsStart: number;
  deathsStart: number;
  drops: Record<string, number>;
  dirty: boolean;
}

interface GameState {
  id: string;
  kills: number;
  /** Monsters seen dying (any killer) - fallback when the kill counter doesn't move. */
  deaths: number;
  visit: Visit | null;
  /** The last map item used and not yet entered, with its possible PD2 API items. */
  /** The character from the join packet; null when the capture joined mid-game. */
  joinedAs: string | null;
  pendingMap: (ItemFields & { candidates: ApiItem[]; mods?: MapStat[] | null }) | null;
  mainRun: number | null;
  /** area -> run, so returning to an area (after a town portal) continues its run. */
  runByArea: Map<number, number>;
  /** A Horazon notice was seen and its map not entered yet. */
  horazonPending: boolean;
  /** Areas corrupted in this game (null: no corruption notice seen). */
  corrupted: Set<number> | null;
  lastEvent: Map<string, number>;
  /** This game's map events, collecting their rewards / shop. */
  events: ActiveEvent[];
  /** Kill counter state of the game's map runs (map and Horazon), by run id. */
  progress: Map<number, RunProgress>;
  /** The map run last entered: running while inside it, paused while out of it. */
  liveRun: number | null;
  /** The boss run last entered, each boss's HP now (`uber_live`), and which of the two was entered last. */
  liveBoss: number | null;
  bossLive: { name: string; bosses: Record<string, number> } | null;
  lastLive: 'map' | 'boss' | null;
  /** Item unit -> the drop recorded for it, for items left on the ground at the end. */
  found: Map<number, number>;
  lastAt: number;
}

/** A map run's monster deaths over its active time (time spent in its areas). */
export interface RunProgress {
  id: number;
  kind: 'map' | 'horazon';
  area: number;
  mapCode: string | null;
  mapQuality: string | null;
  /** The map's properties (density, experience...) when the sidecar read them. */
  mapStats: MapStat[] | null;
  /** Active seconds and monster deaths from the run's closed visits. */
  closedSeconds: number;
  closedDeaths: number;
  /** [active seconds, deaths] samples (saved as map_runs.progress). */
  curve: [number, number][];
  /** Monsters on the map when the game reported how many are left. */
  exactTotal: number | null;
  /** The map's boss once seen, and the active seconds into the run it died at. */
  boss: { name: string; seconds: number | null } | null;
  dirty: boolean;
}

/** Seconds between curve samples (a sample is only taken when deaths changed). */
const SAMPLE_EVERY = 2;

/**
 * How many monsters are left on the map. A guess at the wording: the game doesn't show
 * this yet (planned for the next season) - adjust once a real message is captured.
 */
const MONSTERS_LEFT = /(\d+)\s+(?:monsters?|enemies)\s+(?:remain|left)|(?:monsters?|enemies)\s+(?:remaining|left)\s*:?\s*(\d+)/i;

const games = new Map<string, GameState>();
let lastEventAt: Date | null = null;
// Games are reloaded from the database on their next event (see loadGame).
onDataReplaced(() => games.clear());

/** Rebuild state for a game this process hasn't seen (server restarted mid-game). */
async function loadGame(id: string, ts: Date): Promise<GameState> {
  await pool.query(
    `INSERT INTO games (id, started_at, last_event_at) VALUES ($1, $2, $2) ON CONFLICT (id) DO NOTHING`,
    [id, ts],
  );
  const state: GameState = {
    id,
    kills: 0,
    deaths: 0,
    visit: null,
    joinedAs: null,
    pendingMap: null,
    mainRun: null,
    runByArea: new Map(),
    horazonPending: false,
    lastEvent: new Map(),
    events: [],
    corrupted: null,
    progress: new Map(),
    liveRun: null,
    liveBoss: null,
    bossLive: null,
    lastLive: null,
    found: new Map(),
    lastAt: ts.getTime(),
  };
  const { rows: game } = await pool.query<{ corrupted_areas: number[] | null }>('SELECT corrupted_areas FROM games WHERE id = $1', [id]);
  if (game[0]?.corrupted_areas) state.corrupted = new Set(game[0].corrupted_areas);
  const { rows: runs } = await pool.query<{
    id: string; kind: string; area: number; map_code: string | null; map_quality: string | null; map_stats: MapStat[] | null;
    progress: [number, number][] | null; monsters_total: number | null; seconds: number; deaths: number;
    boss: string | null; boss_seconds: number | null;
  }>(
    `SELECT r.id, r.kind, r.area, r.map_code, r.map_quality, r.map_stats, r.progress, r.monsters_total, r.boss, r.boss_seconds,
            COALESCE(sum(extract(epoch FROM v.left_at - v.entered_at)), 0)::float8 AS seconds,
            COALESCE(sum(v.deaths_end - v.deaths_start) FILTER (WHERE v.left_at IS NOT NULL), 0)::int AS deaths
       FROM map_runs r LEFT JOIN area_visits v ON v.run_id = r.id
      WHERE r.game_id = $1 GROUP BY r.id ORDER BY r.id`,
    [id],
  );
  for (const r of runs) {
    state.runByArea.set(r.area, Number(r.id));
    if (r.kind === 'map') state.mainRun = Number(r.id);
    if (r.kind === 'boss') (state.liveBoss = Number(r.id)), (state.lastLive = 'boss');
    if (r.kind === 'map' || r.kind === 'horazon') {
      state.progress.set(Number(r.id), {
        id: Number(r.id), kind: r.kind, area: r.area, mapCode: r.map_code, mapQuality: r.map_quality, mapStats: r.map_stats,
        closedSeconds: r.seconds, closedDeaths: r.deaths, curve: r.progress ?? [], exactTotal: r.monsters_total,
        boss: r.boss ? { name: r.boss, seconds: r.boss_seconds } : null, dirty: false,
      });
      state.liveRun = Number(r.id);
    }
  }
  const { rows: visits } = await pool.query(
    'SELECT id, area, run_id, entered_at, kills_start, kills_end, deaths_start, deaths_end, drops FROM area_visits WHERE game_id = $1 AND left_at IS NULL ORDER BY entered_at DESC LIMIT 1',
    [id],
  );
  if (visits[0]) {
    const v = visits[0];
    state.visit = {
      id: Number(v.id), area: v.area, runId: v.run_id && Number(v.run_id), enteredAt: v.entered_at.getTime(),
      killsStart: v.kills_start, deathsStart: v.deaths_start, drops: v.drops, dirty: false,
    };
    state.kills = v.kills_end;
    state.deaths = v.deaths_end;
  }
  const { rows: events } = await pool.query<{ id: string; kind: string; at: Date; run_id: string | null; data: EventData }>(
    'SELECT id, kind, at, run_id, data FROM map_events WHERE game_id = $1 ORDER BY at',
    [id],
  );
  state.events = events.map((e) => ({ id: Number(e.id), kind: e.kind, at: e.at.getTime(), runId: e.run_id ? Number(e.run_id) : null, data: e.data, dirty: false }));
  const { rows: horazon } = await pool.query(
    `SELECT 1 FROM map_events WHERE game_id = $1 AND kind = 'horazon'
       AND NOT EXISTS (SELECT 1 FROM map_runs WHERE game_id = $1 AND kind = 'horazon')`,
    [id],
  );
  state.horazonPending = horazon.length > 0;
  games.set(id, state);
  return state;
}

/** Active seconds and monster deaths of a map run so far. */
export function runTotals(g: GameState, p: RunProgress, at: number) {
  const inside = g.visit?.runId === p.id ? g.visit : null;
  return {
    seconds: p.closedSeconds + (inside ? Math.max(0, at - inside.enteredAt) / 1000 : 0),
    deaths: p.closedDeaths + (inside ? g.deaths - inside.deathsStart : 0),
  };
}

function sampleProgress(g: GameState, at: number, force = false) {
  const p = g.visit?.runId != null ? g.progress.get(g.visit.runId) : undefined;
  if (!p) return;
  const { seconds, deaths } = runTotals(g, p, at);
  const last = p.curve.at(-1);
  if (last && (deaths === last[1] || (!force && seconds - last[0] < SAMPLE_EVERY))) return;
  p.curve.push([Math.round(seconds * 10) / 10, deaths]);
  p.dirty = true;
}

async function closeVisit(g: GameState, at: Date) {
  const v = g.visit;
  if (!v) return;
  sampleProgress(g, at.getTime(), true);
  const p = v.runId != null ? g.progress.get(v.runId) : undefined;
  if (p) {
    p.closedSeconds += Math.max(0, at.getTime() - v.enteredAt) / 1000;
    p.closedDeaths += g.deaths - v.deathsStart;
  }
  await pool.query('UPDATE area_visits SET left_at = $2, kills_end = $3, deaths_end = $4, drops = $5 WHERE id = $1', [v.id, at, g.kills, g.deaths, v.drops]);
  if (v.runId) await pool.query('UPDATE map_runs SET ended_at = $2 WHERE id = $1', [v.runId, at]);
  g.visit = null;
}

async function createRun(g: GameState, kind: 'map' | 'horazon' | 'zone', area: number, at: Date, map: GameState['pendingMap']) {
  const candidates = map?.candidates ?? [];
  if (kind === 'map' && !map?.code) {
    // The map wasn't seen being used (the capture started inside it): each map has its own
    // area, so take the base from an earlier run there (unique maps may share it). Quality and
    // modifiers stay unknown.
    const { rows } = await pool.query<{ map_code: string }>(
      `SELECT map_code FROM map_runs WHERE kind = 'map' AND area = $1 AND map_code IS NOT NULL AND map_quality IS DISTINCT FROM 'unique' ORDER BY started_at DESC LIMIT 1`,
      [area],
    );
    if (rows[0]) map = { ...map, candidates, code: rows[0].map_code };
  }
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO map_runs (game_id, parent_id, kind, map_code, map_quality, map_ilvl, map_uid, area, started_at, map_candidates, map_item, boss_tracked, map_stats)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $3 <> 'zone', $12) RETURNING id`,
    [
      g.id, kind === 'horazon' ? g.mainRun : null, kind, map?.code ?? null, map?.quality ?? null, map?.ilvl ?? null, map?.uid ?? null, area, at,
      candidates.length > 1 ? JSON.stringify(candidates) : null,
      candidates.length === 1 ? candidates[0] : null,
      kind === 'map' && map?.mods ? JSON.stringify(map.mods) : null,
    ],
  );
  const id = Number(rows[0].id);
  if (kind !== 'zone') {
    g.progress.set(id, {
      id, kind, area, mapCode: map?.code ?? null, mapQuality: map?.quality ?? null, mapStats: kind === 'map' ? map?.mods ?? null : null,
      closedSeconds: 0, closedDeaths: 0, curve: [], exactTotal: null, boss: null, dirty: false,
    });
  }
  return id;
}

/**
 * A boss fight in this game. Its summon (tier) is the latest of this boss within the hour: re-entering
 * through the summon's portals after a rejoin is a new game, but the same fight. Without a summon
 * seen, a rejoin continues the character's last fight against the boss.
 */
async function createBossRun(g: GameState, boss: string, area: number, at: Date) {
  const { rows: used } = await pool.query<{ at: Date; tier: number | null }>(
    `SELECT at, (data->>'tier')::int AS tier FROM map_events
      WHERE kind = 'uber_used' AND data->>'name' = $1 AND at > $2::timestamptz - interval '1 hour' AND at <= $2 ORDER BY at DESC LIMIT 1`,
    [boss, at],
  );
  let summon: { at: Date | null; tier: number | null } = used[0] ?? { at: null, tier: null };
  if (!used[0]) {
    // Summoned before the capture saw it: a rejoin into the character's last fight against this
    // boss (ended within 30 minutes) is that fight, whose start stands in for the summon.
    const { rows: prev } = await pool.query<{ id: string; summoned_at: Date | null; started_at: Date; boss_tier: number | null }>(
      `SELECT r.id, r.summoned_at, r.started_at, r.boss_tier FROM map_runs r JOIN games pg ON pg.id = r.game_id
        WHERE r.kind = 'boss' AND r.boss = $1 AND pg.character IS NOT DISTINCT FROM (SELECT character FROM games WHERE id = $2)
          AND COALESCE(r.ended_at, pg.ended_at, pg.last_event_at) > $3::timestamptz - interval '30 minutes'
        ORDER BY r.started_at DESC LIMIT 1`,
      [boss, g.id, at],
    );
    if (prev[0]) {
      summon = { at: prev[0].summoned_at ?? prev[0].started_at, tier: prev[0].boss_tier };
      if (!prev[0].summoned_at) await pool.query('UPDATE map_runs SET summoned_at = started_at WHERE id = $1', [prev[0].id]);
    }
  }
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO map_runs (game_id, kind, area, started_at, boss, boss_tier, summoned_at, boss_tracked)
     VALUES ($1, 'boss', $2, $3, $4, $5, $6, true) RETURNING id`,
    [g.id, area, at, boss, summon.tier, summon.at],
  );
  return Number(rows[0].id);
}

/** Every map in the latest PD2 API snapshots that could be the one being opened. */
async function mapCandidates(map: ItemFields): Promise<ApiItem[]> {
  const { rows } = await pool.query<{ item: ApiItem }>(
    `SELECT i AS item FROM sources, jsonb_array_elements(snapshot->'raw'->'items') i
      WHERE i->>'base_code' = $1 AND i->'quality'->>'name' = $2`,
    [map.code, QUALITY_NAME[map.quality ?? 'normal'] ?? 'Normal'],
  );
  return rows.map((r) => r.item);
}

/**
 * Pin down which map each run used: the candidate that disappeared from the PD2 API
 * snapshots. Runs are settled oldest first so one map isn't credited twice.
 */
export async function resolveMapRuns() {
  const { rows: runs } = await pool.query<{ id: string; map_candidates: ApiItem[] }>(
    `SELECT id, map_candidates FROM map_runs
      WHERE map_item IS NULL AND map_candidates IS NOT NULL AND started_at > now() - interval '14 days'
      ORDER BY started_at`,
  );
  if (!runs.length) return;
  const { rows } = await pool.query<{ id: string }>(
    `SELECT DISTINCT i->>'id' AS id FROM sources, jsonb_array_elements(snapshot->'raw'->'items') i WHERE i ? 'id'`,
  );
  const present = new Set(rows.map((r) => r.id));
  const taken = new Set<string>();
  let changed = false;
  for (const run of runs) {
    const gone = run.map_candidates.filter((c) => !present.has(String(c.id)) && !taken.has(String(c.id)));
    if (gone.length !== 1) continue;
    taken.add(String(gone[0].id));
    await pool.query('UPDATE map_runs SET map_item = $2, map_candidates = NULL WHERE id = $1', [run.id, gone[0]]);
    changed = true;
  }
  if (changed) notify('runs');
}

async function enterArea(g: GameState, area: number, at: Date) {
  if (g.visit?.area === area) return;
  await closeVisit(g, at);
  let runId: number | null = null;
  const boss = UBER_AREAS.get(area);
  if (boss) {
    runId = g.runByArea.get(area) ?? [...g.runByArea].find(([a]) => UBER_AREAS.get(a) === boss)?.[1] ?? (await createBossRun(g, boss, area, at));
    g.runByArea.set(area, runId);
    g.liveBoss = runId;
    g.lastLive = 'boss';
  } else if (!TOWNS.has(area)) {
    runId = g.runByArea.get(area) ?? null;
    if (runId === null && g.mainRun === null && g.pendingMap) {
      runId = g.mainRun = await createRun(g, 'map', area, at, g.pendingMap);
      g.pendingMap = null;
    } else if (runId === null && g.mainRun !== null && g.horazonPending) {
      runId = await createRun(g, 'horazon', area, at, null);
      g.horazonPending = false;
    } else if (runId === null && g.mainRun !== null) {
      // Another level of the same map (only one map per game).
      runId = g.mainRun;
    } else if (runId === null && area > LAST_D2_AREA) {
      // A map opened before capture started (picked up mid-game): which map item is unknown.
      runId = g.mainRun = await createRun(g, 'map', area, at, null);
    } else if (runId === null) {
      // A regular zone (act boss, corrupted zone...): its own run, per zone per game.
      runId = await createRun(g, 'zone', area, at, null);
      if (g.corrupted) await pool.query('UPDATE map_runs SET corrupted = $2 WHERE id = $1', [runId, g.corrupted.has(area)]);
    }
    if (runId !== null) g.runByArea.set(area, runId);
  }
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO area_visits (game_id, run_id, area, entered_at, kills_start, kills_end, deaths_start, deaths_end)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $6) RETURNING id`,
    [g.id, runId, area, at, g.kills, g.deaths],
  );
  g.visit = { id: Number(rows[0].id), area, runId, enteredAt: at.getTime(), killsStart: g.kills, deathsStart: g.deaths, drops: {}, dirty: false };
  if (runId !== null && g.progress.has(runId)) (g.liveRun = runId), (g.lastLive = 'map');
}

function currentRun(g: GameState, area?: number | null) {
  return (area != null ? g.runByArea.get(area) : undefined) ?? g.visit?.runId ?? null;
}

async function onNotice(g: GameState, text: string, at: Date) {
  // Game time-limit warnings ("This game is ending in: 29 minutes...") aren't events.
  if (/^This game is ending in/i.test(text.trim())) return;
  const region = /^(\S+)\s+\d+h \d+m remaining$/.exec(text.trim())?.[1];
  if (region) {
    await pool.query('UPDATE games SET region = $2 WHERE id = $1', [g.id, region]);
    return;
  }
  const left = MONSTERS_LEFT.exec(text);
  const p = g.visit?.runId != null ? g.progress.get(g.visit.runId) : undefined;
  if (left && p) {
    p.exactTotal = runTotals(g, p, at.getTime()).deaths + Number(left[1] ?? left[2]);
    p.dirty = true;
    return;
  }
  const corruption = CORRUPTION_NOTICE.exec(text.trim());
  if (corruption) {
    const names = corruption[1].split(/,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean);
    const areas = [...new Set(names.flatMap(areasNamed))];
    if (names.some((n) => !areasNamed(n).length)) console.warn('corruption notice: unknown zone in', text);
    g.corrupted = new Set(areas);
    await pool.query('UPDATE games SET corrupted_areas = $2 WHERE id = $1', [g.id, areas]);
    await pool.query(`UPDATE map_runs SET corrupted = (area = ANY($2::int[])) WHERE game_id = $1 AND kind = 'zone'`, [g.id, areas]);
    return;
  }
  const lower = text.toLowerCase();
  if (TRACED_NOTICES.some((p) => lower.startsWith(p))) return;
  await onMapEvent(g, MAP_EVENTS.find((e) => lower.startsWith(e.prefix))?.kind ?? 'other', text, at);
}

/** A map event, from its notice or a monster / object of it the capture saw. */
async function onMapEvent(g: GameState, kind: string, text: string, at: Date) {
  // A map has each event once; its notice repeats when walking back into range, and near
  // each of its monsters (several Treasure Fallen), which keeps its reward window open.
  const runId = currentRun(g);
  const known = kind !== 'other' && runId !== null ? g.events.find((e) => e.kind === kind && e.runId === runId) : undefined;
  if (known) {
    known.data.lastAt = at.getTime();
    known.dirty = true;
    return;
  }
  const prev = g.lastEvent.get(`${kind}:${text}`);
  g.lastEvent.set(`${kind}:${text}`, at.getTime());
  if (prev !== undefined && at.getTime() - prev < 20_000) return;
  if (kind === 'horazon') g.horazonPending = true;
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO map_events (game_id, run_id, kind, area, at, message) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [g.id, runId, kind, g.visit?.area ?? null, at, text],
  );
  g.events.push({ id: Number(rows[0].id), kind, at: at.getTime(), runId, data: {}, dirty: false });
}

/** Each invader the capture sees: one Invaders event per run listing them. */
async function onInvader(g: GameState, invader: string, text: string, at: Date) {
  const runId = currentRun(g);
  let e = runId !== null ? g.events.find((x) => x.kind === 'invaders' && x.runId === runId) : undefined;
  if (!e) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO map_events (game_id, run_id, kind, area, at, message) VALUES ($1, $2, 'invaders', $3, $4, $5) RETURNING id`,
      [g.id, runId, g.visit?.area ?? null, at, text],
    );
    e = { id: Number(rows[0].id), kind: 'invaders', at: at.getTime(), runId, data: {}, dirty: false };
    g.events.push(e);
  }
  e.data.invaders = [...(e.data.invaders ?? []), invader];
  e.data.lastAt = at.getTime();
  e.dirty = true;
}

/** Count a ground drop towards the rewards of events earlier in the same run. */
function creditEventDrop(g: GameState, code: string, at: Date) {
  const runId = g.visit?.runId;
  if (!runId) return;
  for (const e of g.events) {
    const rule = EVENT_REWARDS[e.kind];
    if (!rule || e.runId !== runId || at.getTime() < e.at || !rule.match(code)) continue;
    if (rule.windowMs && at.getTime() - (e.data.lastAt ?? e.at) > rule.windowMs) continue;
    e.data.drops = { ...e.data.drops, [code]: (e.data.drops?.[code] ?? 0) + 1 };
    e.dirty = true;
  }
}

/** Gheed's shop: the latest Gheed event of this game, if the player is in its map. */
const gheedEvent = (g: GameState) => [...g.events].reverse().find((e) => e.kind === 'gheed' && e.runId !== null && e.runId === g.visit?.runId);

/** Shops are in town but Gheed's: one opened in a map run is his, which tells his event. */
async function onShopItem(g: GameState, ev: ItemFields & { unit: number }, at: Date) {
  if (!gheedEvent(g) && g.visit?.runId != null) await onMapEvent(g, 'gheed', 'Gheed', at);
  const e = gheedEvent(g);
  if (!e || e.data.shop?.some((s) => s.unit === ev.unit)) return;
  e.data.shop = [...(e.data.shop ?? []), { unit: ev.unit, code: ev.code, quality: ev.quality, ilvl: ev.ilvl, ethereal: ev.ethereal }];
  e.dirty = true;
}

function onShopBuy(g: GameState, unit: number) {
  for (const e of g.events) {
    const item = e.data.shop?.find((s) => s.unit === unit);
    if (!item) continue;
    item.bought = true;
    e.dirty = true;
  }
}

/** API-shaped item JSON for a captured item, until the PD2 API reports the real one. */
function captureItem(ev: FoundItem) {
  const stack = stackCodeOf(ev.code);
  if (stack && STACK_NAMES.has(stack)) return stackItem(stack, 1);
  const base = baseInfo(ev.code);
  const quality = ev.quality ?? 'normal';
  // A unique/set picked up unidentified has no name yet: it's its base until identified.
  const name = setOrUniqueName(ev.code, ev.quality, ev.uid);
  return {
    id: 0,
    name: name ?? base?.name ?? ev.code,
    base_code: ev.code,
    quantity: 1,
    quality: { id: QUALITY_ID[quality] ?? 2, name: QUALITY_NAME[quality] ?? 'Normal' },
    base: { id: ev.code, name: base?.name ?? ev.code, category: '', type: base?.type ?? '', type_code: '', size: { width: base?.w ?? 1, height: base?.h ?? 1 } },
    is_identified: name !== null || (quality !== 'unique' && quality !== 'set'),
    is_ethereal: !!ev.ethereal,
    is_simple: false,
    is_runeword: false,
    corrupted: !!ev.mods?.some((m) => m.name === 'corrupted'),
    socket_count: ev.sockets ?? 0,
    graphic_id: ev.graphic ?? null,
    item_level: ev.ilvl,
    modifiers: ev.mods ?? [],
  };
}

/**
 * Record a found item, credited to the run of the zone it dropped in. Items that didn't
 * drop outside town in a captured game (trades, vendors, cube outputs) never count.
 */
async function addItem(g: GameState, kind: 'identified' | 'pickup', ev: FoundItem & { unit?: number }, runId: number, area: number | null, at: Date) {
  const item = captureItem(ev);
  const { rows } = await pool.query<{ character: string | null }>('SELECT character FROM games WHERE id = $1', [g.id]);
  const { rows: added } = await pool.query<{ id: string }>(
    `INSERT INTO drops (found_at, character, name, base_code, quality, quantity, item, source, run_id)
     VALUES ($1, $2, $3, $4, $5, 1, $6, 'capture', $7) RETURNING id`,
    [at, rows[0]?.character ?? null, item.name, item.base_code, item.quality.name, item, runId],
  );
  if (ev.unit !== undefined) g.found.set(ev.unit, Number(added[0].id));
  notify('drops');
  await insertCaptureItem(g, kind, ev, runId, area, at);
}

async function insertCaptureItem(g: GameState, kind: string, ev: ItemFields, runId: number, area: number | null, at: Date) {
  await pool.query(
    `INSERT INTO capture_items (game_id, run_id, at, kind, code, quality, ilvl, uid, ethereal, dropped_here, area)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)`,
    [g.id, runId, at, kind, ev.code, ev.quality ?? null, ev.ilvl ?? null, ev.uid ?? null, !!ev.ethereal, area],
  );
}

/**
 * What a capture records as yours: the kept drops (uniques, sets, runes, valuable currency)
 * and identified magic/rare items - those for the Trade tab's "in your stash" list.
 */
const isFound = (code: string, quality: string | undefined) => isKeptDrop(code, quality) || quality === 'magic' || quality === 'rare';

/** The run of the (non-town) zone an item dropped in, or null. */
const runOfArea = (g: GameState, area: number | null | undefined) => (area != null && !TOWNS.has(area) ? g.runByArea.get(area) ?? null : null);

async function onPickup(g: GameState, ev: FoundItem & { area?: number | null; unit?: number }, at: Date) {
  const runId = runOfArea(g, ev.area);
  // Unidentified items can't be judged yet (a "rare" stays rare, a unique may be kept).
  if (runId === null || !isFound(ev.code, ev.quality)) return;
  if (ev.identified ?? !(ev.quality && NEEDS_ID.has(ev.quality))) await addItem(g, 'pickup', ev, runId, ev.area ?? null, at);
  // Unidentified: remembered until identified (maybe in a later game).
  else await insertCaptureItem(g, 'pending', ev, runId, ev.area ?? null, at);
}

/**
 * A picked-up item was left on the ground outside town when the game ended: its drop is hidden like one
 * ignored by hand (Drops > "With ignored" brings it back), but stays a grail find - a unique
 * can be identified and dropped instead of stored.
 */
async function onDiscarded(g: GameState, ev: ItemFields & { unit: number; area?: number | null }) {
  // Put down in town: handed to another player or a mule, not thrown away.
  if (ev.area != null && TOWNS.has(ev.area)) return;
  // ponytail: unit -> drop lives in memory, so a server restart mid-game forgets it; store
  // the unit on capture_items if that ever bites.
  const id = g.found.get(ev.unit);
  if (id !== undefined) {
    await pool.query('UPDATE drops SET ignored = true, discarded = true, pin_slot = NULL, pinned_at = NULL WHERE id = $1', [id]);
    notify('drops');
    return;
  }
  // Never identified: its pending pickup must not be claimed by a later identification.
  await pool.query(
    `DELETE FROM capture_items WHERE id = (
       SELECT id FROM capture_items WHERE game_id = $1 AND kind = 'pending' AND code = $2 AND quality IS NOT DISTINCT FROM $3
        ORDER BY at DESC LIMIT 1)`,
    [g.id, ev.code, ev.quality ?? null],
  );
}

async function onIdentified(g: GameState, ev: FoundItem & { area?: number | null; droppedHere?: boolean; bought?: boolean; unit?: number }, at: Date) {
  // Bought from Gheed during his map event: name it in the event, count it for that map.
  if (ev.bought && ev.unit !== undefined) {
    const e = g.events.find((x) => x.data.shop?.some((s) => s.unit === ev.unit));
    if (!e) return;
    const item = e.data.shop!.find((s) => s.unit === ev.unit)!;
    item.name = captureItem(ev).name;
    item.uid = ev.uid;
    e.dirty = true;
    if (e.runId !== null && isFound(ev.code, ev.quality)) await addItem(g, 'identified', ev, e.runId, null, at);
    return;
  }
  // The pending pickup of this item: same game first, then the oldest recent one.
  const { rows } = await pool.query<{ id: string; run_id: string | null; area: number | null }>(
    `SELECT id, run_id, area FROM capture_items
      WHERE kind = 'pending' AND code = $1 AND quality IS NOT DISTINCT FROM $2 AND at > now() - interval '30 days'
      ORDER BY (game_id = $3) DESC, at LIMIT 1`,
    [ev.code, ev.quality ?? null, g.id],
  );
  const pending = rows[0];
  if (pending) await pool.query('DELETE FROM capture_items WHERE id = $1', [pending.id]);
  const runId = pending?.run_id ? Number(pending.run_id) : ev.droppedHere ? runOfArea(g, ev.area) : null;
  if (runId !== null && isFound(ev.code, ev.quality)) await addItem(g, 'identified', ev, runId, pending?.area ?? ev.area ?? null, at);
}

/**
 * An item was corrupted (the cube): update its drop in place, keeping the as-dropped
 * version. The drop is found by its properties before the corruption.
 */
/**
 * A cube recipe's crafted item: recorded as a find of yours (source 'craft', not a drop) with
 * what went into it, so its later slam and the trade list can find it.
 */
async function onCrafted(g: GameState, ev: FoundItem & { inputs: { code: string; quality?: string | null }[] }, at: Date) {
  const base = captureItem(ev);
  // Named after its base ("Amulet"): the Crafted tag says the rest.
  const item = { ...base, name: base.base.name, crafted_from: ev.inputs };
  const { rows } = await pool.query<{ character: string | null }>('SELECT character FROM games WHERE id = $1', [g.id]);
  await pool.query(
    `INSERT INTO drops (found_at, character, name, base_code, quality, quantity, item, source)
     VALUES ($1, $2, $3, $4, $5, 1, $6, 'craft')`,
    [at, rows[0]?.character ?? null, item.name, item.base_code, item.quality.name, item],
  );
  notify('drops');
}

/** A slam that turns a unique, set or crafted item into a rare. */
const BRICKABLE = new Set(['unique', 'set', 'crafted']);

/**
 * A corruption (cube slam): logged in `slams` (bricks too) whatever the item, and applied to
 * the find it was made on - matched by its properties before the slam. A brick keeps the
 * find's original (the grail still counts it) and becomes the rare it is now.
 */
async function onCorrupted(
  g: GameState,
  ev: ItemFields & { before: ItemFields & { mods: ItemMod[] | null }; mods: ItemMod[] },
  at: Date,
) {
  const beforeQuality = ev.before.quality ?? ev.quality ?? 'normal';
  const bricked = BRICKABLE.has(beforeQuality) && ev.quality === 'rare';
  const { rows } = await pool.query<{ id: string; name: string; item: { modifiers?: ItemMod[] } & Record<string, unknown> }>(
    `SELECT id, name, item FROM drops
      WHERE source IN ('capture', 'craft') AND base_code = $1 AND quality = $2 AND NOT COALESCE((item->>'corrupted')::boolean, false)
      ORDER BY found_at DESC LIMIT 200`,
    [ev.before.code, QUALITY_NAME[beforeQuality] ?? 'Normal'],
  );
  const before = new Set((ev.before.mods ?? []).map(modKey));
  const overlap = (r: (typeof rows)[number]) => (r.item.modifiers ?? []).filter((m) => before.has(modKey(m))).length;
  let row = rows.reduce<(typeof rows)[number] | undefined>((a, r) => (overlap(r) > (a ? overlap(a) : 0) ? r : a), undefined);
  if (row && overlap(row) < Math.ceil(before.size * 0.6)) row = undefined;
  if (!row) {
    // Drops recorded before properties were captured: only when the name leaves one candidate.
    const name = setOrUniqueName(ev.before.code, beforeQuality, ev.uid);
    const named = rows.filter((r) => name && r.name === name && !r.item.modifiers?.length);
    if (named.length === 1) row = named[0];
  }
  // Lines the corruption added or changed are marked, as the PD2 API marks them; a brick's
  // rolls are all new.
  const modifiers = ev.mods.map((m) => (m.name === 'corrupted' || (!bricked && before.has(modKey(m))) ? m : { ...m, corrupted: true }));
  const beforeItem = row?.item ?? captureItem({ ...ev.before, quality: beforeQuality, mods: ev.before.mods ?? [] });
  const afterItem = { ...captureItem({ ...ev, mods: modifiers }), corrupted: true, ...(bricked ? { bricked: true } : {}) };
  const { rows: who } = await pool.query<{ character: string | null }>('SELECT character FROM games WHERE id = $1', [g.id]);
  await pool.query(
    `INSERT INTO slams (at, game_id, character, code, before_quality, after_quality, bricked, drop_id, before_item, after_item)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      at, g.id, who[0]?.character ?? null, ev.code, QUALITY_NAME[beforeQuality] ?? null, QUALITY_NAME[ev.quality ?? 'normal'] ?? null, bricked,
      row?.id ?? null, beforeItem, afterItem,
    ],
  );
  if (row) {
    const now = captureItem(ev);
    const item = bricked
      ? { ...row.item, ...now, id: row.item.id ?? 0, base_code: ev.code, corrupted: true, bricked: true, modifiers, crafted_from: row.item.crafted_from }
      : { ...row.item, base_code: ev.code, corrupted: true, modifiers, socket_count: ev.sockets ?? row.item.socket_count ?? 0 };
    await pool.query('UPDATE drops SET original_item = COALESCE(original_item, item), item = $2, item_updated_at = $3 WHERE id = $1', [row.id, item, at]);
  }
  notify('drops');
}

async function apply(ev: CaptureEvent) {
  const at = new Date(ev.ts);
  const g = games.get(ev.game) ?? (await loadGame(ev.game, at));
  g.lastAt = Math.max(g.lastAt, at.getTime());
  switch (ev.type) {
    case 'game_start':
      // No character when the capture started mid-game (it's in the join packets): assume
      // the one played last.
      await pool.query(
        `UPDATE games SET server = $3, started_at = LEAST(started_at, $4),
           character = COALESCE($2, (SELECT character FROM games WHERE character IS NOT NULL AND started_at < $4 ORDER BY started_at DESC LIMIT 1))
         WHERE id = $1`,
        [g.id, ev.character ?? null, ev.server ?? null, at],
      );
      g.joinedAs = ev.character ?? null;
      if (ev.character && ev.charClass) await saveCharacterInfo(ev.character, { class: ev.charClass });
      break;
    case 'game_flags':
      await pool.query('UPDATE games SET ladder = $2 WHERE id = $1', [g.id, ev.ladder]);
      notify('stats'); // the character list shows ladder status
      break;
    case 'level':
      // Only when the join was seen: a guessed character (see game_start) could be wrong.
      if (g.joinedAs) await saveCharacterInfo(g.joinedAs, { level: ev.level });
      break;
    case 'xp':
      await pool.query('UPDATE games SET xp_start = COALESCE(xp_start, $2), xp_end = $2, xp_lost = $3 WHERE id = $1', [g.id, ev.xp, ev.lost]);
      break;
    case 'mendeln_xp': {
      const e = [...g.events].reverse().find((x) => x.kind === 'mendeln' && x.runId !== null && x.runId === g.visit?.runId);
      if (e) {
        e.data.xp = (e.data.xp ?? 0) + ev.xp;
        if (ev.total !== null) e.data.xpTotal = ev.total;
        e.dirty = true;
      }
      break;
    }
    case 'game_end':
      for (const e of g.events) if (e.dirty) await pool.query('UPDATE map_events SET data = $2 WHERE id = $1', [e.id, e.data]);
      await closeVisit(g, at);
      await saveProgress(g); // the batch's flush no longer sees this game
      await pool.query('UPDATE games SET ended_at = $2 WHERE id = $1', [g.id, at]);
      games.delete(g.id);
      break;
    case 'area':
      await enterArea(g, ev.area, at);
      break;
    case 'kills':
      if (typeof ev.count === 'number') g.kills = ev.count;
      if (typeof ev.deaths === 'number') g.deaths = ev.deaths;
      if (g.visit) g.visit.dirty = true;
      sampleProgress(g, at.getTime());
      break;
    case 'map_used':
      // Only one map opens per game; the last one used before entering is the one.
      if (g.mainRun === null) g.pendingMap = { ...ev, candidates: await mapCandidates(ev) };
      break;
    case 'drop':
      creditEventDrop(g, ev.code, at);
      if (g.visit) {
        const group = dropGroup(ev.code, ev.quality);
        g.visit.drops[group] = (g.visit.drops[group] ?? 0) + 1;
        g.visit.dirty = true;
      }
      break;
    case 'pickup':
      await onPickup(g, ev, at);
      break;
    case 'identified':
      await onIdentified(g, ev, at);
      break;
    case 'discarded':
      await onDiscarded(g, ev);
      break;
    case 'shop_item':
      await onShopItem(g, ev, at);
      break;
    case 'shop_buy':
      onShopBuy(g, ev.unit);
      break;
    case 'corrupted':
      await onCorrupted(g, ev, at);
      break;
    case 'crafted':
      await onCrafted(g, ev, at);
      break;
    case 'map_event':
      if (ev.event === 'invaders' && ev.invader) await onInvader(g, ev.invader, `Corrupted ${ev.invader}`, at);
      else await onMapEvent(g, ev.event, EVENT_NAMES[ev.event] ?? ev.event, at);
      break;
    case 'notice':
      await onNotice(g, ev.text, at);
      break;
    case 'boss': {
      const runId = currentRun(g, ev.area);
      const p = runId !== null ? g.progress.get(runId) : undefined;
      if (!p) break;
      if (ev.state === 'killed') p.boss = { name: ev.name, seconds: runTotals(g, p, at.getTime()).seconds };
      else p.boss ??= { name: ev.name, seconds: null };
      p.dirty = true;
      break;
    }
    case 'death':
      // Kept for the run it happened in; no view shows them yet (not in EVENT_LABEL).
      await pool.query(
        `INSERT INTO map_events (game_id, run_id, kind, area, at, message, data) VALUES ($1, $2, 'death', $3, $4, $5, $6)`,
        [g.id, currentRun(g, ev.area), ev.area, at, ev.killerName ? `Slain by ${ev.killerName}` : 'Died', { killer: ev.killer, killerName: ev.killerName }],
      );
      break;
    case 'uber_used':
      // An uber boss summoned (Shadow of Hatred opens Lucion's chamber), at the tier set by cubing it.
      await pool.query(
        `INSERT INTO map_events (game_id, run_id, kind, area, at, message, data) VALUES ($1, NULL, 'uber_used', $2, $3, $4, $5)`,
        [g.id, ev.area, at, `${ev.name} summoned (tier ${ev.tier})`, { name: ev.name, code: ev.code, tier: ev.tier, mods: ev.mods ?? null }],
      );
      break;
    case 'uber_killed': {
      // Only in an uber arena: Rathma and Mendeln also spawn in a map event.
      const runId = ev.area != null && UBER_AREAS.has(ev.area) ? currentRun(g, ev.area) : null;
      if (runId === null) break;
      await pool.query(
        `INSERT INTO map_events (game_id, run_id, kind, area, at, message, data) VALUES ($1, $2, 'uber_killed', $3, $4, $5, $6)`,
        [g.id, runId, ev.area, at, `${ev.name} killed`, { name: ev.name }],
      );
      await pool.query(
        `UPDATE map_runs SET boss_seconds = extract(epoch FROM $2::timestamptz - COALESCE(summoned_at, started_at)), boss_hp = 0 WHERE id = $1 AND boss_seconds IS NULL`,
        [runId, at],
      );
      break;
    }
    case 'uber_live':
      // Kept in memory for the live boss timer, like the kill count between saves.
      g.bossLive = { name: ev.name, bosses: ev.bosses };
      break;
    case 'uber_hp': {
      // The lowest HP the bosses were brought to (sent on dying, leaving and the game ending).
      const runId = [...g.runByArea].find(([a]) => UBER_AREAS.get(a) === ev.name)?.[1];
      if (runId === undefined) break;
      const { rows } = await pool.query<{ boss_detail: { bosses?: Record<string, number>; phase?: number | null } | null }>(
        'SELECT boss_detail FROM map_runs WHERE id = $1',
        [runId],
      );
      const was = rows[0]?.boss_detail ?? {};
      const bosses = { ...was.bosses };
      for (const [name, hp] of Object.entries(ev.bosses ?? {})) bosses[name] = Math.min(bosses[name] ?? hp, hp);
      const phase = Math.max(was.phase ?? 0, ev.phase ?? 0) || null;
      await pool.query('UPDATE map_runs SET boss_hp = LEAST(COALESCE(boss_hp, $2), $2), boss_detail = $3 WHERE id = $1', [runId, ev.hp, { bosses, phase }]);
      break;
    }
    case 'portal':
      // Horazon opens his portal when defeated.
      if (g.horazonPending && !TOWNS.has(ev.area) && !g.runByArea.has(ev.area)) {
        const prev = g.lastEvent.get(`portal:${ev.area}`);
        g.lastEvent.set(`portal:${ev.area}`, at.getTime());
        if (prev === undefined) {
          await pool.query(
            `INSERT INTO map_events (game_id, run_id, kind, area, at, message) VALUES ($1, $2, 'horazon_portal', $3, $4, 'Horazon defeated - portal opened')`,
            [g.id, currentRun(g), ev.area, at],
          );
        }
      }
      break;
  }
}

async function saveProgress(g: GameState | undefined) {
  for (const p of g?.progress.values() ?? []) {
    if (!p.dirty) continue;
    await pool.query('UPDATE map_runs SET progress = $2, monsters_total = $3, boss = $4, boss_seconds = $5 WHERE id = $1', [
      p.id, JSON.stringify(p.curve), p.exactTotal, p.boss?.name ?? null, p.boss?.seconds ?? null,
    ]);
    p.dirty = false;
  }
}

/** Write per-visit counters touched by a batch, and the games' last activity. */
async function flush(touched: Set<string>, last: Map<string, Date>) {
  for (const id of touched) {
    const g = games.get(id);
    if (g?.visit?.dirty) {
      await pool.query('UPDATE area_visits SET kills_end = $2, deaths_end = $3, drops = $4 WHERE id = $1', [g.visit.id, g.kills, g.deaths, g.visit.drops]);
      g.visit.dirty = false;
    }
    for (const e of g?.events ?? []) {
      if (!e.dirty) continue;
      await pool.query('UPDATE map_events SET data = $2 WHERE id = $1', [e.id, e.data]);
      e.dirty = false;
    }
    await saveProgress(g);
    await pool.query('UPDATE games SET last_event_at = GREATEST(last_event_at, $2) WHERE id = $1', [id, last.get(id)]);
  }
}

let queue: Promise<void> = Promise.resolve();
let runsNotified = 0;

/** Events are applied strictly in order, one batch at a time. */
function ingest(events: CaptureEvent[]) {
  const run = queue.then(async () => {
    const touched = new Set<string>();
    const last = new Map<string, Date>();
    for (const ev of events) {
      if (!ev || typeof ev.game !== 'string' || typeof ev.ts !== 'number') continue;
      try {
        await apply(ev);
      } catch (err) {
        console.error('capture event failed', ev.type, err);
      }
      if (ev.type !== 'game_end') touched.add(ev.game);
      const at = new Date(ev.ts);
      if (at > (last.get(ev.game) ?? 0)) last.set(ev.game, at);
      if (!lastEventAt || at > lastEventAt) lastEventAt = at;
    }
    await flush(touched, last);
    notify('live');
    // Kill counts arrive every second; run lists only need them now and then.
    if (events.some((e) => e?.type !== 'kills') || Date.now() - runsNotified > 10_000) {
      runsNotified = Date.now();
      notify('runs');
    }
  });
  queue = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------- read side

/**
 * The map run the kill counter shows: the live map run of the newest game in progress
 * (running while inside it, paused while out of it). None once the game ends: the counter
 * only shows in a game. A game without events for 10 minutes (capture stopped, game
 * crashed without its end being seen) no longer counts as in progress.
 */
export function liveRunState(now = Date.now()) {
  const g = [...games.values()].filter((x) => x.liveRun !== null).sort((a, b) => b.lastAt - a.lastAt)[0];
  if (g && now - g.lastAt < 10 * 60_000) {
    const p = g.progress.get(g.liveRun!)!;
    // No events for a while (capture stopped, game crashed): stop the clock at the last one.
    const at = now - g.lastAt < 60_000 ? now : g.lastAt;
    return { game: g, run: p, state: g.visit?.runId === p.id ? ('running' as const) : ('paused' as const), at, totals: runTotals(g, p, at) };
  }
  return null;
}

type RangeQuery = { since?: string; until?: string };

export async function queryRuns({ since, until }: RangeQuery) {
  const { rows: runs } = await pool.query(
    `SELECT r.id::int, r.game_id, r.parent_id::int, r.kind, r.map_code, r.map_quality, r.map_ilvl, r.map_uid, r.area,
            r.map_item->>'name' AS map_name, r.map_stats, r.corrupted, r.boss, r.boss_seconds, r.boss_tracked, r.progress,
            r.boss_tier, r.summoned_at, r.boss_hp, r.boss_detail,
            (SELECT COALESCE(jsonb_agg(m->>'label' ORDER BY (m->>'priority')::int DESC), '[]') FROM jsonb_array_elements(r.map_item->'modifiers') m) AS map_mods,
            r.started_at, COALESCE(r.ended_at, g.ended_at, g.last_event_at) AS ended_at, g.character, g.region, g.ladder,
            (g.ended_at IS NULL AND r.ended_at IS NULL) AS open
       FROM map_runs r JOIN games g ON g.id = r.game_id
      WHERE ($1::timestamptz IS NULL OR r.started_at >= $1) AND ($2::timestamptz IS NULL OR r.started_at < $2)
      ORDER BY r.started_at DESC
      LIMIT 5000`,
    [since ?? null, until ?? null],
  );
  const ids = runs.map((r) => r.id);
  const [{ rows: visits }, { rows: events }, { rows: items }, totals, { rows: bosses }] = await Promise.all([
    pool.query(
      `SELECT v.run_id::int, v.area, v.drops, v.kills_end - v.kills_start AS kills, v.deaths_end - v.deaths_start AS deaths,
              extract(epoch FROM COALESCE(v.left_at, g.ended_at, g.last_event_at) - v.entered_at)::float8 AS seconds
         FROM area_visits v JOIN games g ON g.id = v.game_id WHERE v.run_id = ANY($1::bigint[])`,
      [ids],
    ),
    pool.query('SELECT run_id::int, kind, area, at, data FROM map_events WHERE run_id = ANY($1::bigint[]) ORDER BY at', [ids]),
    pool.query(
      // The drop recorded with it (same run and time) has the full item, properties included.
      `SELECT c.run_id::int, c.at, c.kind, c.code, c.quality, c.ilvl, c.uid, c.ethereal,
              (SELECT d.item FROM drops d WHERE d.run_id = c.run_id AND d.found_at = c.at AND d.base_code = c.code LIMIT 1) AS item
         FROM capture_items c
        WHERE c.run_id = ANY($1::bigint[]) AND c.kind <> 'pending'
          AND NOT EXISTS (SELECT 1 FROM drops d WHERE d.run_id = c.run_id AND d.found_at = c.at AND d.base_code = c.code AND d.ignored)
        ORDER BY c.at`,
      [ids],
    ),
    populationRuns().then(population),
    pool.query<{ area: number; boss: string }>('SELECT DISTINCT ON (area) area, boss FROM map_runs WHERE boss IS NOT NULL ORDER BY area, started_at DESC'),
  ]);
  const bossOf = new Map(bosses.map((b) => [b.area, b.boss]));
  const byRun = new Map(
    runs.map((r) => [r.id, { ...r, seconds: 0, kills: 0, deaths: 0, drops: {} as Record<string, number>, events: [] as unknown[], items: [] as unknown[] }]),
  );
  for (const v of visits) {
    const r = byRun.get(v.run_id);
    if (!r) continue;
    r.seconds += Math.max(0, v.seconds);
    r.kills += Math.max(0, v.kills);
    r.deaths += Math.max(0, v.deaths);
    for (const [k, n] of Object.entries(v.drops as Record<string, number>)) r.drops[k] = (r.drops[k] ?? 0) + n;
  }
  for (const r of byRun.values()) {
    const total = r.kind === 'zone' || r.kind === 'boss' ? null : totals.total(r.area, r.map_code).total;
    (r as typeof r & { clear: number | null }).clear = total && r.deaths ? Math.min(1, r.deaths / total) : null;
    // A tracked run that never saw its boss still names it, from other runs of the map.
    if (r.kind !== 'zone' && r.boss_tracked && !r.boss) r.boss = bossOf.get(r.area) ?? null;
    // The kill rate replaces the (much larger) curve it comes from.
    const curve = (r as { progress?: Curve | null }).progress;
    delete (r as { progress?: unknown }).progress;
    (r as typeof r & { rate: ReturnType<typeof killRate> | null }).rate = curve?.length ? killRate(curve, r.seconds) : null;
  }
  for (const e of events) byRun.get(e.run_id)?.events.push({ kind: e.kind, area: e.area, at: e.at, data: e.data });
  for (const [id, entries] of await bossEntries(runs.filter((r) => r.kind === 'boss').map((r) => r.id))) {
    const r = byRun.get(id) as { entries?: { at: Date; end: Date | null }[] } | undefined;
    if (r) r.entries = entries;
  }
  for (const i of items) {
    const { run_id, ...item } = i;
    byRun.get(run_id)?.items.push(item);
  }
  return [...byRun.values()];
}

/**
 * Boss runs' entries into the fight, by run (a try: tier 0 and Uber Tristram allow four). Moving
 * on to the next of Rathma's arenas is the same entry; coming back from town is a new one.
 */
export async function bossEntries(runIds: number[]) {
  const out = new Map<number, { at: Date; end: Date | null }[]>();
  if (!runIds.length) return out;
  const { rows } = await pool.query<{ run_id: number; entered_at: Date; left_at: Date | null; prev: string | null }>(
    `SELECT run_id::int, entered_at, left_at, prev FROM (
       SELECT v.run_id, v.entered_at, COALESCE(v.left_at, g.ended_at, g.last_event_at) AS left_at,
              lag(v.run_id) OVER (PARTITION BY v.game_id ORDER BY v.entered_at, v.id) AS prev
         FROM area_visits v JOIN games g ON g.id = v.game_id
        WHERE v.game_id IN (SELECT game_id FROM map_runs WHERE id = ANY($1::bigint[]))
     ) x WHERE run_id = ANY($1::bigint[]) ORDER BY entered_at`,
    [runIds],
  );
  for (const v of rows) {
    const entries = out.get(v.run_id) ?? [];
    if (v.prev !== null && Number(v.prev) === v.run_id && entries.length) entries[entries.length - 1].end = v.left_at;
    else entries.push({ at: v.entered_at, end: v.left_at });
    out.set(v.run_id, entries);
  }
  return out;
}

/**
 * The boss fight the live timer shows: the boss run last entered in the newest game in progress,
 * when that game's last run was a boss fight (not a map). In town between entries it goes on: the
 * fight's clock runs from the summon.
 */
export function liveBossState(now = Date.now()) {
  const g = [...games.values()].sort((a, b) => b.lastAt - a.lastAt)[0];
  if (!g || g.liveBoss === null || g.lastLive !== 'boss' || now - g.lastAt >= 10 * 60_000) return null;
  return {
    runId: g.liveBoss,
    inArena: g.visit?.runId === g.liveBoss,
    // No events for a while (capture stopped, game crashed): stop the clock at the last one.
    at: now - g.lastAt < 60_000 ? now : g.lastAt,
    hp: g.bossLive,
  };
}

/**
 * Delete a run (an outlier, a map closed right away...). Its visits, events and finds
 * stay with the game, no longer tied to a run; a Horazon map inside it goes with it.
 */
async function deleteRun(id: number) {
  for (const g of games.values()) {
    if (g.progress.has(id) && g.liveRun === id) throw new RunInUse();
  }
  const safety = await createBackup('safety');
  const { rowCount } = await pool.query('DELETE FROM map_runs WHERE id = $1', [id]);
  for (const g of games.values()) {
    g.progress.delete(id);
    for (const [area, run] of g.runByArea) if (run === id) g.runByArea.delete(area);
    if (g.mainRun === id) g.mainRun = null;
  }
  return { deleted: rowCount ?? 0, safety };
}

class RunInUse extends Error {}

export function registerCaptureRoutes(app: FastifyInstance) {
  app.delete<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    try {
      const result = await deleteRun(Number(req.params.id));
      notify('runs');
      notify('live');
      return result;
    } catch (err) {
      if (err instanceof RunInUse) return reply.code(409).send({ error: 'This run is still being played' });
      throw err;
    }
  });

  app.post<{ Body: { events?: CaptureEvent[] } }>('/api/capture/events', { bodyLimit: 16 * 1024 * 1024 }, async (req) => {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    await ingest(events);
    return { ok: true, received: events.length };
  });

  app.get<{ Querystring: RangeQuery }>('/api/runs', async (req) => {
    const runs = await queryRuns(req.query);
    // Events outside any run (e.g. while the run was not detected) still count.
    const { rows: eventCounts } = await pool.query(
      `SELECT kind, count(*)::int AS count FROM map_events
        WHERE ($1::timestamptz IS NULL OR at >= $1) AND ($2::timestamptz IS NULL OR at < $2)
        GROUP BY kind`,
      [req.query.since ?? null, req.query.until ?? null],
    );
    return { runs, eventCounts: Object.fromEntries(eventCounts.map((r) => [r.kind, r.count])) };
  });

  // Per-game totals, all time: the kill/map counters behind Progress (the game's kill
  // counter restarts every game, so kills are summed per game).
  app.get('/api/capture/games', async () => {
    const { rows } = await pool.query(
      `SELECT g.id, g.character, g.ladder, g.started_at, COALESCE(g.ended_at, g.last_event_at) AS ended_at,
              COALESCE(max(v.kills_end), 0)::int AS kills, COALESCE(max(v.deaths_end), 0)::int AS deaths,
              (SELECT count(*)::int FROM map_runs r WHERE r.game_id = g.id AND r.kind = 'map') AS maps,
              (SELECT count(*)::int FROM map_runs r WHERE r.game_id = g.id AND r.kind = 'boss') AS fights,
              (SELECT count(*)::int FROM map_events e WHERE e.game_id = g.id AND e.kind = 'death') AS died,
              g.xp_start::float8 AS xp_start, g.xp_end::float8 AS xp_end, g.xp_lost::float8 AS xp_lost
         FROM games g LEFT JOIN area_visits v ON v.game_id = g.id
        GROUP BY g.id ORDER BY g.started_at`,
    );
    return { games: rows };
  });

  app.get('/api/capture/status', async () => {
    const { rows } = await pool.query(
      `SELECT g.id, g.character, g.started_at, g.last_event_at,
              (SELECT area FROM area_visits v WHERE v.game_id = g.id ORDER BY entered_at DESC LIMIT 1) AS area
         FROM games g WHERE g.ended_at IS NULL AND g.last_event_at > now() - interval '10 minutes'
        ORDER BY g.started_at DESC LIMIT 1`,
    );
    const { rows: latest } = await pool.query('SELECT max(last_event_at) AS at FROM games');
    return { lastEventAt: lastEventAt ?? latest[0]?.at ?? null, game: rows[0] ?? null };
  });
}
