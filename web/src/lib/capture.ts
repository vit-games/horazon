import type { KillRate } from '../components/KillRateChart';
import areaNames from '../data/areas.json';
import gameData from '../data/game-data.json';
import { rangeParams, type Range } from './api';
import { isNotable } from './rank';
import { PUL } from './runes';
import { tierOf } from './tiers';
import type { Drop, Item } from './types';
import type { ValuesData } from './values';

// Data from the capture sidecar (server/src/capture.ts): map runs, events, finds.

export interface CaptureItem {
  at: string;
  /** 'identified' (dropped unidentified, then identified) | 'pickup' (never needs identifying) */
  kind: string;
  code: string;
  quality: string | null;
  ilvl: number | null;
  uid: number | null;
  ethereal: boolean;
  /** The drop recorded for it: the full item, properties included (null for older finds). */
  item?: Item | null;
}

export interface MapStat {
  stat: string;
  value: number;
  /** Tooltip wording, e.g. "Monster Density: +126%". */
  label: string;
}

/** One of a map's property values by stat name, e.g. 'map_glob_density'. */
export const mapStat = (stats: MapStat[] | null | undefined, stat: string): number | null => stats?.find((m) => m.stat === stat)?.value ?? null;

/** A map's monster density bonus (%), the property that matters most for a run. */
export const mapDensity = (r: MapRun): number | null => mapStat(r.map_stats, 'map_glob_density');

/**
 * Density as a colour: light below +100%, towards yellow up to +180%, red from there.
 */
export function densityColor(density: number): string {
  if (density >= 180) return '#ff5a46';
  const t = Math.min(1, Math.max(0, (density - 100) / 80));
  // #f1e6c8 (cream) -> #ffc93a (yellow)
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(0xf1, 0xff)} ${mix(0xe6, 0xc9)} ${mix(0xc8, 0x3a)})`;
}

/** Map properties that add content: monster types (in the map's order), an extra boss, fortification. */
export const MAP_CONTENT = [
  'map_glob_add_mon_shriek',
  'map_glob_add_mon_doll',
  'map_glob_add_mon_succ',
  'map_glob_add_mon_vamp',
  'map_glob_add_mon_cow',
  'map_glob_add_mon_horde',
  'map_glob_add_mon_ghost',
  'map_glob_add_mon_souls',
  'map_glob_add_mon_fetish',
  'map_glob_extra_boss',
  'map_glob_skirmish_mode',
];
export const mapContent = (stats: MapStat[] | null | undefined): MapStat[] =>
  (stats ?? []).filter((m) => MAP_CONTENT.includes(m.stat)).sort((a, b) => MAP_CONTENT.indexOf(a.stat) - MAP_CONTENT.indexOf(b.stat));

export interface MapRun {
  id: number;
  game_id: string;
  /** Whether its game was a ladder game; null when not captured. */
  ladder: boolean | null;
  parent_id: number | null;
  /**
   * 'map' | 'horazon' (a map opened by Horazon inside a map) | 'zone' (any other zone outside town)
   * | 'boss' (an uber boss fight; boss = the encounter, boss_seconds from the summon)
   */
  kind: string;
  /** Zone runs: corrupted zone (null until it can be detected). */
  corrupted: boolean | null;
  map_code: string | null;
  map_quality: string | null;
  map_ilvl: number | null;
  map_uid: number | null;
  /** From the PD2 API once the used map is pinned down (see server resolveMapRuns). */
  map_name: string | null;
  map_mods: string[];
  /** The map's properties read from its item packet when opened, most important first. */
  map_stats: MapStat[] | null;
  area: number;
  started_at: string;
  ended_at: string | null;
  /** Still in progress (game running and not left yet). */
  open: boolean;
  character: string | null;
  region: string | null;
  seconds: number;
  /** The game's kill counter (the player's kills). */
  kills: number;
  /** Monsters seen dying, by anyone - shown when the kill counter didn't move. */
  deaths: number;
  /** Maps: share of the map's monsters that died (estimated from the best run of the map). */
  clear: number | null;
  /** Maps: the map's boss (also when it wasn't found in this run), and when it died (active seconds). */
  boss: string | null;
  boss_seconds: number | null;
  /** Captured with boss tracking: no kill time means the boss was skipped. */
  boss_tracked: boolean;
  /** Boss runs: the summon item's cubed tier (0-2), null when the summon wasn't seen. */
  boss_tier: number | null;
  /** Boss runs: when the summon was used, shared by every run of one fight (rejoins). */
  summoned_at: string | null;
  /** Boss runs: the lowest HP (%) the boss was brought to; 0 once killed, null when not seen. */
  boss_hp: number | null;
  /** Boss runs: each boss's lowest HP (%), and for Rathma the phase reached (1-3). */
  boss_detail: { bosses?: Record<string, number>; phase?: number | null } | null;
  /** Boss runs: each entry into the fight, a try (tier 0 and Uber Tristram allow four). */
  entries?: { at: string; end: string | null }[];
  /** Kills per minute over the run (from its kill curve; null for runs without one). */
  rate: KillRate | null;
  drops: Record<string, number>;
  events: RunEvent[];
  items: CaptureItem[];
}

/** A clear as the kill counter counts one: at least this share of the map's monsters dead. */
export const CLEAR = 0.9;
/**
 * A finished map run that cleared the map, judged on the whole percent the tables show (89.6%
 * reads 90%). Times and kill rates compare clears only: a run left at 30% isn't a fast clear.
 */
/** The boss was tracked and didn't die, in a run actually played: a run left at under 10% cleared says nothing about the boss. */
export const bossSkipped = (r: MapRun) => r.boss_tracked && r.boss_seconds === null && !r.open && (r.clear ?? 0) >= 0.1;

/** Times the player died in a run. */
export const playerDeaths = (r: MapRun) => r.events.filter((e) => e.kind === 'death').length;

export const isClear = (r: MapRun) => !r.open && r.clear !== null && Math.round(r.clear * 100) >= CLEAR * 100;

export interface ShopItem {
  unit: number;
  code: string;
  quality?: string;
  ilvl?: number;
  ethereal?: boolean;
  bought?: boolean;
  /** Set once a bought unique is identified. */
  name?: string;
  /** Unique/set index of the bought item (a gamble can roll a better base, so not the code). */
  uid?: number;
}

export interface RunEvent {
  kind: string;
  area: number | null;
  at: string;
  /** What the event produced: reward drops counted after it, Gheed's shop, the invaders' classes. */
  data?: { drops?: Record<string, number>; shop?: ShopItem[]; invaders?: string[]; xp?: number; xpTotal?: number };
}

/** Reward items each event claims from its map's drops (mirrors server EVENT_REWARDS). */
const MAP_ORB_CODES = new Set(['imma', 'irma', 'imra', 'irra', 'upma', 'urma', 'scou', 'rera', 'rrra', 'upmp', 'scrb', 'fort']);
export const EVENT_REWARDS: Record<string, { match: (code: string) => boolean; noun: string; approx?: boolean }> = {
  spire: { match: (c) => c === 'pk1' || c === 'pk2' || c === 'pk3', noun: 'keys' },
  catalyst_altar: { match: (c) => c === 'iwss', noun: 'catalysts' },
  dark_wanderer: { match: (c) => c === 'wss' || c === 'cwss', noun: 'shards' },
  mendeln: { match: (c) => c === 'rtmv', noun: 'splinters' },
  invaders: { match: (c) => /^ive[a-z]$/.test(c), noun: 'ears' },
  treasure_fallen: { match: (c) => /^r\d\ds?$/.test(c) || MAP_ORB_CODES.has(c) || /^t[1-4][0-9a-z]$/.test(c), noun: 'treasures', approx: true },
};

export interface RunsResponse {
  runs: MapRun[];
  eventCounts: Record<string, number>;
}

export interface CaptureStatus {
  lastEventAt: string | null;
  game: { id: string; character: string | null; started_at: string; last_event_at: string; area: number | null } | null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.url.replace(location.origin, '')} failed: ${res.status}`);
  return res.json();
}

export const fetchRuns = async (range: Range): Promise<RunsResponse> => json(await fetch(`/api/runs?${rangeParams(range)}`));
export async function deleteRun(id: number) {
  const res = await fetch(`/api/runs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `deleting failed: ${res.status}`);
}
export interface CaptureGame {
  id: string;
  character: string | null;
  ladder: boolean | null;
  started_at: string;
  ended_at: string;
  /** The game's kill counter at the end (it restarts every game) - misses some kills. */
  kills: number;
  /** Monsters seen dying, never-counted ones aside: the kills. */
  deaths: number;
  maps: number;
  /** Boss runs (uber fights) in the game. */
  fights: number;
  /** Times the player died. */
  died: number;
  /** Experience at the game's first and latest reading, and what deaths cost in it; null before XP was read. */
  xp_start: number | null;
  xp_end: number | null;
  xp_lost: number | null;
}
export const fetchCaptureGames = async (): Promise<CaptureGame[]> =>
  (await json<{ games: CaptureGame[] }>(await fetch('/api/capture/games'))).games;

export const fetchCaptureStatus = async (): Promise<CaptureStatus> => json(await fetch('/api/capture/status'));

/** Map events from wiki.projectdiablo2.com/wiki/Maps, in the order the wiki lists them. */
export const EVENTS: { kind: string; label: string; message: string; reward: string }[] = [
  { kind: 'dark_wanderer', label: 'Dark Wanderer', message: 'Darkness itself wanders these lands...', reward: 'Worldstone Shards' },
  { kind: 'mendeln', label: 'Shadow of Mendeln', message: 'Evil beckons you from the Void...', reward: 'Splinter of the Void' },
  { kind: 'horazon', label: 'Horazon', message: 'An alternate dimension radiates dark energy...', reward: 'Portal to a new map' },
  { kind: 'treasure_fallen', label: 'Treasure Fallen', message: 'A shrieking, mischievious laughter pierces your ears...', reward: 'Runes, gems, maps, orbs' },
  { kind: 'spire', label: 'Spire of Darkness', message: 'A faint humming keeps the dark at bay...', reward: 'Uber keys' },
  { kind: 'gheed', label: 'Gheed', message: 'You hear coins being counted nearby...', reward: 'Sells unidentified uniques' },
  { kind: 'catalyst_altar', label: 'Altar of the Catalyst', message: 'A mysterious altar vibrates with potential...', reward: 'Catalyst Shards' },
  { kind: 'invaders', label: 'Invaders', message: "You feel a corrupted presence watching you, as if you're being hunted...", reward: 'Rare sets, corrupted ear' },
];
export const EVENT_LABEL: Record<string, string> = Object.fromEntries(EVENTS.map((e) => [e.kind, e.label]));

// Diablo II 1.13 levels.txt names by id (1-136); PD2 map zones (above that) are named by their map.
const AREAS: string[] = areaNames;
const TOWNS = new Set([1, 40, 75, 103, 109]);
export const townName = (area: number | null) => (area !== null && TOWNS.has(area) ? AREAS[area] : null);
export const areaName = (area: number | null) => (area === null ? 'Unknown' : AREAS[area] || `Area ${area}`);

/** Worldstone Shards (normal and tainted) - counted daily on Activity. */
export const isShard = (code: string) => code === 'wss' || code === 'cwss';

type Named = { id?: number; base: string };
const bases = gameData.bases as Record<string, { name: string | null; type: string | null }>;
const uniqueById = new Map(Object.entries(gameData.uniques as Record<string, Named>).map(([name, u]) => [u.id, { name, base: u.base }]));
const setById = new Map(Object.entries(gameData.sets as Record<string, Named>).map(([name, s]) => [s.id, { name, base: s.base }]));
/** Base code -> the one unique/set on it, for bases with a single one (each Rainbow Facet is one site row). */
const onlyOnBase = (table: Record<string, Named>) => {
  const counts = new Map<string, number>();
  for (const e of Object.values(table)) counts.set(e.base, (counts.get(e.base) ?? 0) + 1);
  return new Map(Object.entries(table).filter(([, e]) => counts.get(e.base) === 1).map(([name, e]) => [e.base, name]));
};
const uniqueOnBase = onlyOnBase(gameData.uniques as Record<string, Named>);
const setOnBase = onlyOnBase(gameData.sets as Record<string, Named>);

export const baseName = (code: string) => bases[code]?.name ?? code;

/** Base type "Map T3" + name "Arreat Battlefield Map" -> { name: 'Arreat Battlefield', tier: 'T3' }. */
export function mapInfo(code: string | null): { name: string; tier: string | null } {
  if (!code) return { name: 'Unknown map', tier: null };
  const base = bases[code];
  const tier = /\bT\d\b/.exec(base?.type ?? '')?.[0] ?? (base?.type === 'Uber' ? 'Uber' : null);
  const name = (base?.name ?? code).replace(/ Map$/, '');
  return { name: name === 'Map' || !name ? `${tier ?? ''} map`.trim() : name, tier };
}

export type MapTier = 'T1' | 'T2' | 'T3' | 'T4' | 'Unique';
/** T1-T3 and unique maps always show; T4 (dungeons) once there are runs there. */
export const MAP_TIERS: MapTier[] = ['T1', 'T2', 'T3', 'T4', 'Unique'];

/** Unique maps each have their own base (t51-t58): base code -> unique name. */
const UNIQUE_MAPS = new Map(
  Object.entries(gameData.uniques as Record<string, Named>)
    .filter(([, u]) => bases[u.base]?.type === 'Map T5')
    .map(([name, u]) => [u.base, name]),
);

/** Every map there is, by tier: T1-T4 bases and the unique maps. */
export const MAP_CATALOG: { code: string; name: string; tier: MapTier }[] = [
  ...Object.entries(bases).flatMap(([code, b]) => {
    const tier = /^Map (T[1-4])$/.exec(b.type ?? '')?.[1] as MapTier | undefined;
    return tier ? [{ code, name: mapInfo(code).name, tier }] : [];
  }),
  ...[...UNIQUE_MAPS].map(([code, name]) => ({ code, name, tier: 'Unique' as MapTier })),
].sort((a, b) => a.name.localeCompare(b.name));

/** Tier of a map run: unique maps are a tier of their own. */
export function runTier(code: string | null, quality: string | null): MapTier | null {
  if (!code) return null;
  if (UNIQUE_MAPS.has(code) || quality === 'unique') return 'Unique';
  return (/^Map (T[1-4])$/.exec(bases[code]?.type ?? '')?.[1] as MapTier | undefined) ?? null;
}

/**
 * Name of an identified unique/set from its in-game index. The site's ids run one
 * ahead of the game's for part of the table, so check neighbours and keep the one
 * whose base matches the dropped item.
 */
export function itemName(code: string, quality: string | null, uid: number | null): string | null {
  if (uid === null || (quality !== 'unique' && quality !== 'set')) return null;
  const table = quality === 'unique' ? uniqueById : setById;
  for (const id of [uid, uid + 1, uid - 1, uid + 2]) {
    const hit = table.get(id);
    if (hit && hit.base === code) return hit.name;
  }
  return (quality === 'unique' ? uniqueOnBase : setOnBase).get(code) ?? null;
}

/** Display name of a captured item or run map (unique maps have their own names). */
export function captureName(i: { code: string; quality: string | null; uid: number | null }): string {
  return itemName(i.code, i.quality, i.uid) ?? baseName(i.code);
}

const QUALITY_NAME: Record<string, string> = {
  inferior: 'Inferior', normal: 'Normal', superior: 'Superior', magic: 'Magic', set: 'Set', rare: 'Rare', unique: 'Unique', crafted: 'Crafted',
};

/** An Item-shaped stand-in so captured items render with ItemIcon / quality colours. */
export function asItem(i: { code: string; quality: string | null; uid: number | null; ethereal?: boolean }): Item {
  const base = bases[i.code];
  return {
    id: 0,
    name: captureName(i),
    base_code: i.code,
    quality: { id: 0, name: QUALITY_NAME[i.quality ?? ''] ?? 'Normal' },
    base: { id: i.code, name: base?.name ?? i.code, category: '', type: base?.type ?? '', type_code: '', size: { width: 1, height: 1 } },
    is_identified: itemName(i.code, i.quality, i.uid) !== null || !['unique', 'set'].includes(i.quality ?? ''),
    is_ethereal: !!i.ethereal,
    is_simple: false,
    is_runeword: false,
    corrupted: false,
    socket_count: 0,
    graphic_id: null,
    modifiers: [],
  };
}

/** A run's map as an item, for the item tooltip: its properties as modifiers. */
export function mapItem(r: MapRun, name: string, tier: string | null): Item {
  const item = asItem({ code: r.map_code ?? '', quality: r.map_quality, uid: r.map_uid });
  const n = r.map_stats?.length ?? r.map_mods.length;
  const modifiers = r.map_stats
    ? r.map_stats.map((m, i) => ({ name: m.stat, label: m.label, values: [m.value], priority: n - i }))
    : r.map_mods.map((label, i) => ({ name: '', label, values: [], priority: n - i }));
  return {
    ...item,
    name,
    // The second title line (the base): "T3 Map" rather than the name again.
    base: { ...item.base, name: tier ? `${tier} Map` : 'Map' },
    is_identified: true,
    item_level: r.map_ilvl ?? undefined,
    corrupted: !!r.map_stats?.some((m) => m.stat === 'corrupted'),
    modifiers,
  };
}

/**
 * Kills for a run: monsters seen dying (the never-counted ones - monster-cast hydras, own
 * summons - left out by the capture), which matches the game's `.kills`. The game's own kill
 * counter misses some (about 1 in 10) and is only a fallback (`approx`).
 */
export const runKills = (r: { kills: number; deaths: number }) =>
  r.deaths > 0 || !r.kills ? { n: r.deaths, approx: false } : { n: r.kills, approx: true };

/** Runes from Vex up. */
export const HIGH_RUNE = 26;

/** A captured find counted as notable: the app's one rule (`isNotable` in rank.ts), Pul+ runes. */
export function isNotableFind(i: { code: string; quality: string | null; uid: number | null; item?: Item | null }, values: ValuesData): boolean {
  const item = i.item ?? asItem(i);
  return isNotable({ item } as Drop, PUL, tierOf(item, values));
}

/** Text colour for a captured item: runes in rune orange, otherwise by quality. */
export const itemColor = (i: { code: string; quality: string | null }) =>
  /^r\d\ds?$/.test(i.code) ? 'text-q-crafted' : QUALITY_COLOR[i.quality ?? ''] ?? 'text-text';

export const QUALITY_COLOR: Record<string, string> = {
  unique: 'text-q-unique',
  set: 'text-q-set',
  rare: 'text-q-rare',
  magic: 'text-q-magic',
  crafted: 'text-q-crafted',
  rune: 'text-q-crafted',
  shard: 'text-q-normal',
  map: 'text-text',
  other: 'text-q-gray',
};

/** Total reward items an event produced. */
export const eventRewardCount = (e: RunEvent) => Object.values(e.data?.drops ?? {}).reduce((a, b) => a + b, 0);
