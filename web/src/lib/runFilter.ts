import { EVENT_LABEL, isNotableFind, mapDensity, runKills, runTier, type MapRun, type MapTier } from './capture';
import type { ValuesData } from './values';

/** Monster types and other content map affixes add (MAP_CONTENT), for the filter. */
export const CONTENT_LABEL: Record<string, string> = {
  map_glob_add_mon_shriek: 'Minions of Destruction',
  map_glob_add_mon_doll: 'Stygian Dolls',
  map_glob_add_mon_succ: 'Succubus Witches',
  map_glob_add_mon_vamp: 'Vampire Lords',
  map_glob_add_mon_cow: 'Hell Bovines',
  map_glob_add_mon_horde: 'Reanimated Horde',
  map_glob_add_mon_ghost: 'Ghosts',
  map_glob_add_mon_souls: 'Burning Souls',
  map_glob_add_mon_fetish: 'Fetishes',
  map_glob_extra_boss: 'Additional boss',
  map_glob_skirmish_mode: 'Fortified',
};

/** Sort keys, each with the direction that puts the best runs first. */
export const RUN_SORTS = {
  newest: { label: 'Newest', desc: true },
  density: { label: 'Density', desc: true },
  time: { label: 'Time', desc: false },
  kills: { label: 'Kills', desc: true },
  rate: { label: 'Kills/min', desc: true },
  clear: { label: 'Clear', desc: true },
  boss: { label: 'Boss time', desc: false },
  finds: { label: 'Notable', desc: true },
} as const;
export type RunSort = keyof typeof RUN_SORTS;

export interface RunFilter {
  tiers: MapTier[];
  /** Map base code, '' for any. */
  map: string;
  /** '' any, 'some' with an event, 'none' without, or an event kind. */
  event: string;
  /** '' any, or a MAP_CONTENT stat. */
  content: string;
  corrupted: boolean;
  /** Character name, '' for any (only offered with several characters' runs). */
  character: string;
  sort: RunSort;
  /** Flipped from the sort's own direction. */
  reversed: boolean;
}
export const NO_FILTER: RunFilter = { tiers: [], map: '', event: '', content: '', corrupted: false, character: '', sort: 'newest', reversed: false };

const events = (r: MapRun) => r.events.filter((e) => e.kind in EVENT_LABEL);
const finds = (r: MapRun, v: ValuesData) => r.items.filter((i) => isNotableFind(i, v)).length;

function value(r: MapRun, sort: RunSort, v: ValuesData): number | null {
  switch (sort) {
    case 'newest': return new Date(r.started_at).getTime();
    case 'density': return mapDensity(r);
    case 'time': return r.open ? null : r.seconds;
    case 'kills': return runKills(r).n;
    case 'rate': return r.rate?.avg ?? null;
    case 'clear': return r.clear;
    case 'boss': return r.boss_seconds;
    case 'finds': return finds(r, v);
  }
}

export function matches(r: MapRun, f: RunFilter): boolean {
  const tier = runTier(r.map_code, r.map_quality);
  if (f.tiers.length && (!tier || !f.tiers.includes(tier))) return false;
  if (f.map && r.map_code !== f.map) return false;
  const ev = events(r);
  if (f.event === 'some' ? !ev.length : f.event === 'none' ? ev.length > 0 : f.event && !ev.some((e) => e.kind === f.event)) return false;
  if (f.content && !r.map_stats?.some((m) => m.stat === f.content)) return false;
  if (f.corrupted && !r.map_stats?.some((m) => m.stat === 'corrupted')) return false;
  if (f.character && r.character !== f.character) return false;
  return true;
}

/** The runs passing the filter, in its order; runs without the sorted value (no density read...) last. */
export function filterRuns(runs: MapRun[], f: RunFilter, values: ValuesData): MapRun[] {
  const desc = RUN_SORTS[f.sort].desc !== f.reversed;
  return runs
    .filter((r) => matches(r, f))
    .map((r) => ({ r, v: value(r, f.sort, values) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === null ? (b.v === null ? 0 : 1) : -1;
      return (desc ? b.v - a.v : a.v - b.v) || new Date(b.r.started_at).getTime() - new Date(a.r.started_at).getTime();
    })
    .map(({ r }) => r);
}

export const isFiltered = (f: RunFilter) => f.tiers.length > 0 || !!f.map || !!f.event || !!f.content || f.corrupted || !!f.character;
