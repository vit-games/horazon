import { fmtRate, KillRateChart } from './KillRateChart';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { NonLadderTag } from './CharacterPicker';
import { ClassIcon } from './ClassIcon';
import { EventIcon, MAP_CRAFT_STATS, MapCrafts } from './EventIcon';
import { Ledger } from './Ledger';
import { Pager } from './Pager';
import { Segmented } from './Segmented';
import { Seg } from './Seg';
import { EventResult } from './EventResult';
import { ItemIcon } from './ItemIcon';
import { FloatingTooltip } from './ItemTooltip';
import { NewMark } from './NewTag';
import { fetchGrail, type GrailFound } from '../lib/api';
import { useChanges } from '../lib/live';
import type { CharacterInfo, Item } from '../lib/types';
import {
  EVENTS,
  EVENT_LABEL,
  EVENT_REWARDS,
  eventRewardCount,
  MAP_CATALOG,
  MAP_TIERS,
  QUALITY_COLOR,
  asItem,
  captureName,
  areaName,
  deleteRun,
  isClear,
  bossSkipped,
  playerDeaths,
  isNotableFind,
  itemColor,
  runKills,
  densityColor,
  mapContent,
  mapDensity,
  mapItem,
  mapInfo,
  runTier,
  type MapTier,
  type MapRun,
} from '../lib/capture';
import { fmtCompact, fmtNumber } from '../lib/series';
import { fmtClock } from '../lib/time';
import { CONTENT_LABEL, filterRuns, isFiltered, NO_FILTER, RUN_SORTS, type RunFilter, type RunSort } from '../lib/runFilter';
import { toolbarSm as select } from '../lib/ui';
import { useValues, type ValuesData } from '../lib/values';

const startFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The run list's columns: date, map, density, boss, time, kills, kills/min, clear, delete. */
const RUN_COLUMNS =
  'flex flex-wrap gap-x-4 gap-y-1 md:grid md:grid-cols-[6.5rem_minmax(12rem,1fr)_4rem_5.5rem_4rem_4.5rem_8rem_3rem_0.75rem]';

/** A zone's runs (opened on Zones): date, zone, corrupted, time, kills, kills/min, shards, delete. */
const ZONE_COLUMNS = 'flex flex-wrap gap-x-4 gap-y-1 md:grid md:grid-cols-[6.5rem_minmax(12rem,1fr)_5rem_4rem_4.5rem_5rem_3.5rem_0.75rem]';

/** Short "T3 Arreat Battlefield" style label for a run's map. */
export function runMapLabel(r: MapRun, parent?: MapRun): { name: string; tier: string | null; color: string } {
  if (r.kind === 'zone') return { name: areaName(r.area), tier: null, color: 'text-text' };
  if (r.kind === 'horazon') {
    const p = parent ? mapInfo(parent.map_code) : null;
    return { name: `Horazon's portal${p ? ` · from ${p.name}` : ''}`, tier: null, color: 'text-text' };
  }
  if (runTier(r.map_code, r.map_quality) === 'Unique') {
    // Each unique map has its own base, so the base names it.
    const name = MAP_CATALOG.find((m) => m.tier === 'Unique' && m.code === r.map_code)?.name ?? r.map_name ?? mapInfo(r.map_code).name;
    return { name, tier: 'Unique', color: QUALITY_COLOR.unique };
  }
  return { ...mapInfo(r.map_code), color: QUALITY_COLOR[r.map_quality ?? ''] ?? 'text-text' };
}

type View = 'maps' | 'log';
const VIEWS: { key: View; label: string }[] = [
  { key: 'maps', label: 'By map' },
  { key: 'log', label: 'Log' },
];
const VIEW_KEY = 'horazon.maps.view';

type Character = Pick<CharacterInfo, 'name' | 'class' | 'level' | 'ladder'>;

/**
 * Map-run summary for a set of runs: tiles, events, tier breakdown, run list. With several
 * characters' runs, a per-character comparison too (of `compare`, default the same runs - a
 * season's summary leaves non-ladder characters out, their clears still compare), and the run
 * list tags and filters by character.
 */
/** `#runs/<subtab>/<run id>`: the run a link (from the Session page) opens to; null without one. */
export const focusFromHash = (): number | null => {
  const id = Number(location.hash.split('/')[2]);
  return id > 0 ? id : null;
};

/** Does `act` once per focused run, as soon as `ready` (the data holding it is there): later updates don't pull the view back. */
export function useFocusOnce(focus: number | null, ready: boolean, act: () => void) {
  const done = useRef<number | null>(null);
  useEffect(() => {
    if (focus === null || done.current === focus || !ready) return;
    done.current = focus;
    act();
  });
}

/** The focused row: scrolled into view once, and marked. */
export function useFocusedRow(on: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (on) ref.current?.scrollIntoView({ block: 'center' });
  }, [on]);
  return { ref, mark: on ? 'bg-accent/10 ring-1 ring-inset ring-accent/60' : '' };
}

export function MapOverview({
  runs: all,
  compare,
  characters = [],
  focus = null,
}: {
  runs: MapRun[];
  compare?: MapRun[];
  characters?: Character[];
  focus?: number | null;
}) {
  const runs = useMemo(() => all.filter((r) => r.kind === 'map' || r.kind === 'horazon'), [all]);
  const compared = useMemo(() => (compare ?? all).filter((r) => r.kind === 'map'), [compare, all]);
  // The characters with runs, most runs first, with class, level and ladder status where known.
  const charsOf = (rs: MapRun[]) => {
    const n = new Map<string, number>();
    for (const r of rs) if (r.kind === 'map' && r.character) n.set(r.character, (n.get(r.character) ?? 0) + 1);
    return [...n]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([name]) => characters.find((c) => c.name === name) ?? { name, class: null, level: null, ladder: null });
  };
  const chars = useMemo(() => charsOf(runs), [runs, characters]);
  const compareChars = useMemo(() => charsOf(compared), [compared, characters]);
  const view = useMemo(() => {
    const maps = runs.filter((r) => r.kind === 'map');
    const horazonRuns = runs.filter((r) => r.kind === 'horazon');
    const children = new Map<number, MapRun[]>();
    for (const r of horazonRuns) if (r.parent_id !== null) children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r]);
    const done = maps.filter(isClear);
    const counts: Record<string, number> = {};
    for (const r of runs) for (const e of r.events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    return { maps, children, done, counts };
  }, [runs]);

  const { maps, done, counts } = view;
  const [mode, setMode] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'log' ? 'log' : 'maps';
    } catch {
      return 'maps';
    }
  });
  const pickMode = (v: View) => {
    setMode(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage blocked: the view lasts until reload
    }
  };
  // A linked run opens in the Log (without changing the view you keep).
  useFocusOnce(focus, runs.some((r) => r.id === focus), () => setMode('log'));
  const sum = (rs: MapRun[], f: (r: MapRun) => number) => rs.reduce((n, r) => n + f(r), 0);
  const time = sum(done, (r) => r.seconds);
  const kills = sum(done, (r) => runKills(r).n);
  const totalEvents = EVENTS.reduce((n, e) => n + (counts[e.kind] ?? 0), 0);
  const withEvent = maps.filter((r) => r.events.some((e) => e.kind in EVENT_LABEL)).length;
  const avgTime = done.length ? sum(done, (r) => r.seconds) / done.length : null;
  const avgKills = done.length ? sum(done, (r) => runKills(r).n) / done.length : null;
  const values = useValues();
  const notable = runs.reduce((n, r) => n + r.items.filter((i) => isNotableFind(i, values)).length, 0);

  // Runs lead: comparing runs is what this page is for; per-tier and per-character summaries and
  // the map events follow.
  return (
    <>
      <Ledger
        items={[
          { value: fmtNumber(maps.length), label: maps.length === 1 ? 'map' : 'maps' },
          { value: avgTime !== null ? fmtClock(avgTime) : '–', label: 'avg time', title: 'Time inside the map, clears of 90%+' },
          { value: avgKills !== null ? fmtNumber(avgKills) : '–', label: 'avg kills', title: 'Clears of 90%+' },
          { value: time ? fmtNumber((kills / time) * 60) : '–', label: 'kills / min', title: 'Inside maps, clears of 90%+' },
          {
            value: fmtNumber(totalEvents),
            label: totalEvents === 1 ? 'event' : 'events',
            title: maps.length ? `${Math.round((withEvent / maps.length) * 100)}% of maps had one` : undefined,
          },
          { value: fmtNumber(notable), label: 'notable', title: 'Notable finds in maps: tiered items, Pul+ runes and valuable currency' },
        ]}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Seg options={VIEWS} value={mode} onChange={pickMode} />
        <ClearsNote runs={maps} />
      </div>
      {mode === 'maps' ? (
        <>
          <MapList runs={maps} children={view.children} characters={chars.length > 1 ? chars : []} />
          {compareChars.length > 1 && <CharacterTable runs={compared} characters={compareChars} />}
          <MapEvents counts={counts} runs={runs} />
        </>
      ) : (
        <RunList runs={maps} children={view.children} characters={chars.length > 1 ? chars : []} focus={focus} />
      )}
    </>
  );
}

/** One line per event kind: how often, and what it gave. */
function eventSummary(kind: string, n: number, counts: Record<string, number>, runs: MapRun[]): string | null {
  if (!n) return null;
  const of = runs.flatMap((r) => r.events).filter((e) => e.kind === kind);
  if (kind === 'horazon') {
    const defeated = counts.horazon_portal ?? 0;
    const portals = runs.filter((r) => r.kind === 'horazon').length;
    return `${defeated} defeated · ${portals} portal${portals === 1 ? '' : 's'} entered`;
  }
  if (kind === 'gheed') {
    const shops = of.filter((e) => e.data?.shop?.length);
    const bought = of.reduce((x, e) => x + (e.data?.shop?.filter((s) => s.bought).length ?? 0), 0);
    return `${shops.length} shop${shops.length === 1 ? '' : 's'} seen · ${bought} bought`;
  }
  const reward = EVENT_REWARDS[kind];
  if (!reward) return null;
  const total = of.reduce((x, e) => x + eventRewardCount(e), 0);
  const rewards = `${reward.approx ? '~' : ''}${total} ${reward.noun} · ${(total / n).toFixed(1)} per event`;
  if (kind === 'invaders') return `${of.reduce((x, e) => x + (e.data?.invaders?.length ?? 0), 0)} invaders · ${rewards}`;
  const xp = of.reduce((x, e) => x + (e.data?.xp ?? 0), 0);
  if (kind === 'mendeln' && xp) return `${rewards} · +${fmtCompact(xp)} xp`;
  return rewards;
}

/**
 * Map events: a row per kind seen (how often, what it gave), which also filters the log of
 * every event below it, newest first, with the map it happened in and what it produced.
 */
function MapEvents({ counts, runs }: { counts: Record<string, number>; runs: MapRun[] }) {
  const [kinds, setKinds] = useState<string[]>([]);
  const [map, setMap] = useState('');
  const [page, setPage] = useState(0);
  const byId = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);
  const rows = useMemo(
    () =>
      runs
        .flatMap((r) => r.events.filter((e) => e.kind in EVENT_LABEL).map((e) => ({ e, run: r })))
        .sort((a, b) => b.e.at.localeCompare(a.e.at)),
    [runs],
  );
  // A Horazon run's events belong to the map it was opened from.
  const mapOf = (run: MapRun) => (run.parent_id !== null ? byId.get(run.parent_id) ?? run : run).map_code;
  const maps = useMemo(() => {
    const m = new Map<string, { name: string; tier: string | null; n: number }>();
    for (const { run } of rows) {
      const code = mapOf(run);
      if (!code) continue;
      const x = m.get(code) ?? { ...runMapLabel(run.parent_id !== null ? byId.get(run.parent_id) ?? run : run), n: 0 };
      m.set(code, { ...x, n: x.n + 1 });
    }
    return [...m].sort(([, a], [, b]) => (a.tier ?? '').localeCompare(b.tier ?? '') || a.name.localeCompare(b.name));
  }, [rows, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const seen = EVENTS.filter((e) => (counts[e.kind] ?? 0) > 0);
  const unseen = EVENTS.filter((e) => !counts[e.kind]);
  const shown = rows.filter(({ e, run }) => (!kinds.length || kinds.includes(e.kind)) && (!map || mapOf(run) === map));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const at = Math.min(page, pages - 1);
  const filtered = kinds.length > 0 || map !== '';
  const toggle = (kind: string) => {
    setKinds((k) => (k.includes(kind) ? k.filter((x) => x !== kind) : [...k, kind]));
    setPage(0);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="text-lg text-text">Map events</h2>
        {seen.length > 0 && (
          <span className="flex items-center gap-3">
            {maps.length > 1 && (
              <select className={select} value={map} onChange={(e) => (setMap(e.target.value), setPage(0))} aria-label="Map">
                <option value="">All maps</option>
                {maps.map(([code, m]) => (
                  <option key={code} value={code}>
                    {m.tier ? `${m.tier} ` : ''}
                    {m.name} ({m.n})
                  </option>
                ))}
              </select>
            )}
            {filtered && (
              <button className="text-xs text-accent hover:underline" onClick={() => (setKinds([]), setMap(''), setPage(0))}>
                Clear
              </button>
            )}
          </span>
        )}
      </div>

      {seen.length > 0 && (
        <table className="w-full rounded-sm border border-line bg-panel text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line text-left">
              <th className="px-4 py-1.5 font-normal">Event</th>
              <th className="px-3 py-1.5 text-right font-normal">Seen</th>
              <th className="px-4 py-1.5 font-normal">What it gave</th>
            </tr>
          </thead>
          <tbody>
            {seen.map((e) => {
              const on = kinds.includes(e.kind);
              return (
                <tr
                  key={e.kind}
                  className={`cursor-pointer border-b border-line/50 last:border-0 ${on ? 'bg-panel-hi' : 'hover:bg-panel-hi/60'}`}
                  onClick={() => toggle(e.kind)}
                  title={e.message}
                >
                  <td className="px-4 py-1.5">
                    <button className="flex items-center gap-2 text-left" aria-pressed={on} onClick={(ev) => (ev.stopPropagation(), toggle(e.kind))}>
                      <EventIcon kind={e.kind} />
                      <span className={on ? 'text-accent' : 'text-text'}>{e.label}</span>
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-right">{fmtNumber(counts[e.kind])}</td>
                  <td className="px-4 py-1.5 text-muted">{eventSummary(e.kind, counts[e.kind], counts, runs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted">
        {seen.length === 0 ? 'No map events in this period. ' : 'Pick an event to list only those below. '}
        {unseen.length > 0 && <>Not seen yet: {unseen.map((e) => e.label).join(', ')}.</>}
      </p>

      {rows.length > 0 &&
        (shown.length === 0 ? (
          <p className="rounded-sm border border-line bg-panel px-4 py-6 text-sm text-muted">No events match these filters.</p>
        ) : (
          <div className="rounded-sm border border-line bg-panel">
            <ul>
              {shown.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE).map(({ e, run }) => {
                const label = runMapLabel(run, run.parent_id !== null ? byId.get(run.parent_id) : undefined);
                return (
                  <li key={`${run.id}:${e.at}:${e.kind}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line/60 px-4 py-2 text-sm last:border-0">
                    <span className="w-28 shrink-0 text-xs text-muted tabular-nums">{startFmt.format(new Date(e.at))}</span>
                    <span className="flex w-48 items-center gap-2">
                      <EventIcon kind={e.kind} />
                      {EVENT_LABEL[e.kind]}
                    </span>
                    <span className="w-48 truncate">
                      {label.tier && <span className="mr-2 text-xs text-muted">{label.tier}</span>}
                      <span className={label.color}>{label.name}</span>
                    </span>
                    <EventResult
                      event={e}
                      defeated={run.events.some((x) => x.kind === 'horazon_portal')}
                      entered={runs.some((r) => r.kind === 'horazon' && r.parent_id === run.id)}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-muted">
              <span className="tabular-nums">
                {at * PAGE_SIZE + 1}–{Math.min(shown.length, (at + 1) * PAGE_SIZE)} of {shown.length}
                {shown.length < rows.length && ` (${rows.length} in this period)`}
              </span>
              {pages > 1 && <Pager page={at} pages={pages} onPage={setPage} />}
            </div>
          </div>
        ))}
    </section>
  );
}

/** Times and kills are of the clears (90%+) only; runs, events and finds count every run. */
interface MapStats {
  runs: number;
  clears: number;
  seconds: number;
  best: number | null;
  /** Median clear time. */
  typical: number | null;
  kills: number;
  events: number;
  finds: number;
}

const TREND_POINTS = 24;

/**
 * Clear times of the clears (90%+) in the order they were played, evenly spaced - only the
 * order matters, not when. Many runs are averaged in consecutive groups, at most TREND_POINTS.
 */
function trendOf(runs: MapRun[]): { x: number; v: number }[] {
  const times = runs
    .filter(isClear)
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
    .map((r) => r.seconds);
  const n = Math.min(times.length, TREND_POINTS);
  return Array.from({ length: n }, (_, i) => {
    const group = times.slice(Math.floor((i * times.length) / n), Math.floor(((i + 1) * times.length) / n));
    return { x: n > 1 ? i / (n - 1) : 0.5, v: group.reduce((x, t) => x + t, 0) / group.length };
  });
}

/** Clear-time sparkline: higher is slower, scaled to the row's own range. */
function Sparkline({ points, width = 96, height = 22 }: { points: { x: number; v: number }[]; width?: number; height?: number }) {
  if (points.length < 2) return <span className="text-muted">—</span>;
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const pad = 2;
  const y = (v: number) => (hi === lo ? height / 2 : pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(p.x * width).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  return (
    <svg
      width={width}
      height={height}
      className="inline-block align-middle"
      role="img"
      aria-label="Clear time, run by run"
    >
      <title>{`Clear time, run by run: ${fmtClock(points[0].v)} → ${fmtClock(points.at(-1)!.v)} (fastest ${fmtClock(lo)}, slowest ${fmtClock(hi)})`}</title>
      <path d={d} className="stroke-series" fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function statsOf(runs: MapRun[], values: ValuesData): MapStats {
  const clears = runs.filter(isClear);
  return {
    runs: runs.length,
    clears: clears.length,
    seconds: clears.reduce((n, r) => n + r.seconds, 0),
    best: clears.length ? Math.min(...clears.map((r) => r.seconds)) : null,
    typical: median(clears.map((r) => r.seconds)),
    kills: clears.reduce((n, r) => n + runKills(r).n, 0),
    events: runs.reduce((n, r) => n + r.events.filter((e) => e.kind in EVENT_LABEL).length, 0),
    finds: runs.reduce((n, r) => n + r.items.filter((i) => isNotableFind(i, values)).length, 0),
  };
}

function median(vs: number[]): number | null {
  if (!vs.length) return null;
  const s = [...vs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The runs whose times and kills a row leaves out. */
const unfinished = (s: MapStats) =>
  s.runs === s.clears ? `${plural(s.clears, 'clear')} of 90%+` : `${plural(s.clears, 'clear')} of 90%+; ${plural(s.runs - s.clears, 'unfinished run')} not counted in times and kills`;
/** What the tables leave out, said once above them. */
function ClearsNote({ runs }: { runs: MapRun[] }) {
  const n = runs.filter((r) => !isClear(r)).length;
  return (
    <span className="text-xs text-muted">
      Times and kills: clears of 90%+{n > 0 && ` · ${plural(n, 'unfinished run')} not counted`}
    </span>
  );
}

/**
 * Every map run, one row per map grouped by tier (T1-T3, T4 dungeons, unique maps): how often,
 * how fast, how it trends and what it gave. A map opens to its own runs; maps never run share
 * one line under their tier.
 */
type MapSort = 'runs' | 'best' | 'typical' | 'rate' | 'events' | 'finds';
/** A map's value for a column; null sorts last whichever way. Times sort fastest first. */
const MAP_SORTS: Record<MapSort, { of: (s: MapStats) => number | null; low: boolean; label: string }> = {
  runs: { of: (s) => s.runs, low: false, label: 'runs' },
  best: { of: (s) => s.best, low: true, label: 'best clear' },
  typical: { of: (s) => s.typical, low: true, label: 'typical clear' },
  rate: { of: (s) => (s.seconds ? (s.kills / s.seconds) * 60 : null), low: false, label: 'kills per minute' },
  events: { of: (s) => s.events, low: false, label: 'events' },
  finds: { of: (s) => s.finds, low: false, label: 'notable' },
};

/** A sortable table's column definitions: the value per row, and whether lower sorts first. */
export type Sorts<K extends string, T> = Record<K, { of: (row: T) => number | null; low: boolean; label: string }>;
export type SortState<K extends string> = { key: K; flip: boolean } | null;

/** Rows sorted by a column, as Maps sorts them: best first (flip reverses), empty values last. */
export function sortRows<K extends string, T>(rows: T[], sorts: Sorts<K, T>, sort: SortState<K>): T[] {
  if (!sort) return rows;
  const { of, low } = sorts[sort.key];
  const up = low !== sort.flip;
  return [...rows].sort((a, b) => {
    const x = of(a);
    const y = of(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return up ? x - y : y - x;
  });
}

/** A column header that sorts its table, as Maps' do: a new column sorts best-first, the active one flips. */
export function SortHead<K extends string, T>({
  k,
  text,
  sorts,
  sort,
  onSort,
  className = 'px-3 py-2 text-right tabular-nums font-normal',
  title,
}: {
  k: K;
  text: string;
  sorts: Sorts<K, T>;
  sort: SortState<K>;
  onSort: (s: SortState<K>) => void;
  className?: string;
  title?: string;
}) {
  const on = sort?.key === k;
  const up = sorts[k].low !== (on && !!sort?.flip);
  return (
    <th className={className} aria-sort={on ? (up ? 'ascending' : 'descending') : undefined}>
      <button className={`hover:text-text ${on ? 'text-accent' : ''}`} onClick={() => onSort(on ? { key: k, flip: !sort!.flip } : { key: k, flip: false })} title={title ?? `Sort by ${sorts[k].label}`}>
        {text}
        {on && <span aria-hidden>{up ? ' ↑' : ' ↓'}</span>}
      </button>
    </th>
  );
}

function MapList({ runs, children, characters }: { runs: MapRun[]; children: Map<number, MapRun[]>; characters: Character[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: MapSort; flip: boolean }>({ key: 'runs', flip: false });
  const [page, setPage] = useState(0);
  const values = useValues();
  const grail = useRunGrail(runs, children);
  const tiers = useMemo(() => {
    const byCode = new Map<string, MapRun[]>();
    for (const r of runs) if (r.map_code) byCode.set(r.map_code, [...(byCode.get(r.map_code) ?? []), r]);
    return MAP_TIERS.map((tier) => {
      const all = MAP_CATALOG.filter((m) => m.tier === tier).map((m) => {
        const rs = (byCode.get(m.code) ?? []).sort((a, b) => b.started_at.localeCompare(a.started_at));
        return { ...m, runs: rs, stats: statsOf(rs, values), trend: trendOf(rs) };
      });
      const tierRuns = runs.filter((r) => runTier(r.map_code, r.map_quality) === tier);
      return {
        tier,
        maps: all.filter((m) => m.stats.runs),
        unrun: all.filter((m) => !m.stats.runs),
        stats: statsOf(tierRuns, values),
        trend: trendOf(tierRuns),
      };
    }).filter((t) => t.stats.runs > 0);
  }, [runs, values]);
  // Maps sort within their tier; the tiers keep their order.
  const sorted = (maps: (typeof tiers)[number]['maps']) => {
    const { of, low } = MAP_SORTS[sort.key];
    const up = low !== sort.flip;
    return [...maps].sort((a, b) => {
      const x = of(a.stats);
      const y = of(b.stats);
      if (x === null || y === null) return x === y ? a.name.localeCompare(b.name) : x === null ? 1 : -1;
      return (up ? x - y : y - x) || b.stats.runs - a.stats.runs || a.name.localeCompare(b.name);
    });
  };
  const head = (key: MapSort, text: string, title?: string) => {
    const on = sort.key === key;
    const up = MAP_SORTS[key].low !== (on && sort.flip);
    return (
      <th className={`${cell} font-normal`} aria-sort={on ? (up ? 'ascending' : 'descending') : undefined}>
        <button className={`hover:text-text ${on ? 'text-accent' : ''}`} onClick={() => setSort(on ? { key, flip: !sort.flip } : { key, flip: false })} title={title ?? `Sort by ${MAP_SORTS[key].label}`}>
          {text}
          {on && <span aria-hidden>{up ? ' ↑' : ' ↓'}</span>}
        </button>
      </th>
    );
  };
  const byName = new Map(characters.map((c) => [c.name, c]));
  const toggle = (code: string) => {
    setOpen((o) => (o === code ? null : code));
    setPage(0);
  };

  const cell = 'px-3 py-2 text-right tabular-nums';
  const dash = <span className="text-muted">—</span>;
  const cells = (s: MapStats) => (
    <>
      <td className={cell} title={s.runs ? unfinished(s) : undefined}>{s.runs || dash}</td>
      <td className={cell}>{s.best !== null ? fmtClock(s.best) : dash}</td>
      <td className={cell}>{s.typical !== null ? fmtClock(s.typical) : dash}</td>
      <td className={cell}>{s.seconds ? fmtNumber((s.kills / s.seconds) * 60) : dash}</td>
      <td className={cell}>{s.events || dash}</td>
      <td className={cell}>{s.finds || dash}</td>
    </>
  );
  const COLS = 8;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg text-text">Maps</h2>
      <div className="rounded-sm border border-line bg-panel">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 text-left font-normal">Map</th>
                <th className="w-32 px-3 py-2 text-left font-normal">Trend</th>
                {head('runs', 'Runs')}
                {head('best', 'Best')}
                {head('typical', 'Typical', 'Sort by typical (median) clear')}
                {head('rate', 'Kills/min')}
                {head('events', 'Events')}
                {head('finds', 'Notable', 'Sort by notable: tiered items, Pul+ runes and valuable currency')}
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <Fragment key={t.tier}>
                  <tr className="border-b border-line/60 bg-panel-hi/40">
                    <th scope="rowgroup" className="px-3 py-2 text-left font-normal">
                      <span className={`font-semibold ${t.tier === 'Unique' ? 'text-q-unique' : 'text-text'}`}>{t.tier === 'Unique' ? 'Unique maps' : t.tier}</span>
                      <span className="ml-2 text-xs text-muted">
                        {t.maps.length}/{t.maps.length + t.unrun.length} maps run
                      </span>
                    </th>
                    <td className="px-3 py-1">
                      <Sparkline points={t.trend} />
                    </td>
                    {cells(t.stats)}
                  </tr>
                  {sorted(t.maps).map((m) => {
                    const on = open === m.code;
                    const pages = Math.max(1, Math.ceil(m.runs.length / PAGE_SIZE));
                    const at = Math.min(page, pages - 1);
                    return (
                      <Fragment key={m.code}>
                        <tr className={`cursor-pointer border-b border-line/40 ${on ? 'bg-panel-hi' : 'hover:bg-panel-hi/60'}`} onClick={() => toggle(m.code)}>
                          <td className="py-1.5 pr-3 pl-3">
                            <button
                              className="flex items-center gap-2 text-left"
                              aria-expanded={on}
                              onClick={(e) => (e.stopPropagation(), toggle(m.code))}
                            >
                              <span className="inline-block w-3 text-muted" aria-hidden>
                                {on ? '▾' : '▸'}
                              </span>
                              <span className={t.tier === 'Unique' ? 'text-q-unique' : 'text-text'}>{m.name}</span>
                            </button>
                          </td>
                          <td className="px-3 py-1">
                            <Sparkline points={m.trend} />
                          </td>
                          {cells(m.stats)}
                        </tr>
                        {on && (
                          <tr className="border-b border-line">
                            <td colSpan={COLS} className="bg-bg/40 p-0">
                              {/* The runs have their own columns (the Log's): their own header, so no value reads as the table's. */}
                              <RunHeader />
                              <ul>
                                {m.runs.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE).map((r) => (
                                  <li key={r.id} className="border-b border-line/60 last:border-0">
                                    <RunRow
                                      run={r}
                                      entered={(children.get(r.id) ?? []).length > 0}
                                      character={
                                        characters.length && r.character
                                          ? { name: r.character, cls: byName.get(r.character)?.class ?? null, ladder: r.ladder ?? byName.get(r.character)?.ladder ?? null }
                                          : undefined
                                      }
                                      grail={grail}
                                    />
                                    {(children.get(r.id) ?? []).map((c) => (
                                      <div key={c.id} className="border-t border-dashed border-line/60">
                                        <RunRow run={c} parent={r} grail={grail} />
                                      </div>
                                    ))}
                                  </li>
                                ))}
                              </ul>
                              {pages > 1 && (
                                <div className="flex justify-end border-t border-line/60 px-4 py-2 text-xs">
                                  <Pager page={at} pages={pages} onPage={setPage} />
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {t.unrun.length > 0 && (
                    <tr className="border-b border-line/40 last:border-0">
                      <td colSpan={COLS} className="px-3 py-1.5 pl-8 text-xs text-muted">
                        Not run yet: {t.unrun.map((m) => m.name).join(', ')}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {/* The column definitions, in words rather than hover text. */}
      <p className="text-xs text-muted">
        Trend: each clear's time in the order played, higher is slower · Typical: median clear · Notable: tiered items, Pul+ runes and valuable currency
      </p>
    </section>
  );
}

/**
 * Characters side by side over the same maps: all, a tier or one map. The best value of each
 * column is highlighted; events and finds are per run, as the characters ran different amounts.
 */
function CharacterTable({ runs, characters }: { runs: MapRun[]; characters: Character[] }) {
  const [scope, setScope] = useState('');
  const values = useValues();
  const options = useMemo(() => {
    const maps = new Map<string, { name: string; tier: string | null; chars: Set<string> }>();
    for (const r of runs) {
      if (!r.map_code) continue;
      const m = maps.get(r.map_code) ?? { ...runMapLabel(r), chars: new Set<string>() };
      if (r.character) m.chars.add(r.character);
      maps.set(r.map_code, m);
    }
    return {
      tiers: MAP_TIERS.filter((t) => runs.some((r) => runTier(r.map_code, r.map_quality) === t)),
      // Maps more than one character ran: the ones worth comparing on.
      maps: [...maps].filter(([, m]) => m.chars.size > 1).sort(([, a], [, b]) => (a.tier ?? '').localeCompare(b.tier ?? '') || a.name.localeCompare(b.name)),
    };
  }, [runs]);
  const inScope = useMemo(() => {
    if (scope.startsWith('tier:')) return runs.filter((r) => runTier(r.map_code, r.map_quality) === scope.slice(5));
    if (scope.startsWith('map:')) return runs.filter((r) => r.map_code === scope.slice(4));
    return runs;
  }, [runs, scope]);
  const rows = characters.map((c) => {
    const rs = inScope.filter((r) => r.character === c.name);
    const s = statsOf(rs, values);
    return {
      c,
      rs,
      s,
      avg: s.clears ? s.seconds / s.clears : null,
      avgKills: s.clears ? s.kills / s.clears : null,
      rate: s.seconds ? (s.kills / s.seconds) * 60 : null,
      events: s.runs ? s.events / s.runs : null,
      finds: s.runs ? s.finds / s.runs : null,
    };
  });
  type Row = (typeof rows)[number];
  const bestOf = (f: (r: Row) => number | null, low: boolean) => {
    const vs = rows.map(f).filter((v): v is number => v !== null);
    return vs.length > 1 ? (low ? Math.min(...vs) : Math.max(...vs)) : null;
  };
  const best = {
    avg: bestOf((r) => r.avg, true),
    best: bestOf((r) => r.s.best, true),
    avgKills: bestOf((r) => r.avgKills, false),
    rate: bestOf((r) => r.rate, false),
    events: bestOf((r) => r.events, false),
    finds: bestOf((r) => r.finds, false),
  };
  const cell = 'px-3 py-2 text-right tabular-nums';
  const dash = <span className="text-muted">—</span>;
  const td = (v: number | null, top: number | null, fmt: (v: number) => string) => (
    <td className={`${cell} ${v !== null && v === top ? 'font-semibold text-accent' : ''}`}>{v === null ? dash : fmt(v)}</td>
  );
  const perRun = (v: number) => v.toFixed(2);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg text-text">By character</h2>
        <span className="mr-auto ml-1 self-baseline">
          <ClearsNote runs={inScope} />
        </span>
        <select
          className="rounded-sm border border-line bg-panel px-2 py-1 text-xs text-text outline-none focus:border-accent/60"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          title="Compare on the same maps"
        >
          <option value="">All maps</option>
          {options.tiers.map((t) => (
            <option key={t} value={`tier:${t}`}>
              {t === 'Unique' ? 'Unique maps' : `${t} maps`}
            </option>
          ))}
          {options.maps.length > 0 && (
            <optgroup label="Maps run by several characters">
              {options.maps.map(([code, m]) => (
                <option key={code} value={`map:${code}`}>
                  {m.tier ? `${m.tier} ` : ''}
                  {m.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </header>
      <div className="rounded-sm border border-line bg-panel">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-2 text-left font-normal">Character</th>
              <th className="px-3 py-2 text-left font-normal" title="Clear time of each finished run in the order played (evenly spaced), higher is slower">
                Clear time
              </th>
              <th className={`${cell} font-normal`}>Runs</th>
              <th className={`${cell} font-normal`}>Avg time</th>
              <th className={`${cell} font-normal`}>Best</th>
              <th className={`${cell} font-normal`}>Avg kills</th>
              <th className={`${cell} font-normal`}>Kills/min</th>
              <th className={`${cell} font-normal`}>Events/run</th>
              <th className={`${cell} font-normal`} title="Tiered items, Pul+ runes and valuable currency, per run">
                Notable/run
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.c.name} className={`border-b border-line/40 last:border-0 ${r.s.runs ? '' : 'text-muted'}`}>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <ClassIcon cls={r.c.class} />
                    {r.c.name}
                    {r.c.level != null && <span className="text-xs text-muted tabular-nums">{r.c.level}</span>}
                    {r.c.ladder === false && <NonLadderTag />}
                  </span>
                </td>
                <td className="px-3 py-1">
                  <Sparkline points={trendOf(r.rs)} />
                </td>
                <td className={cell} title={r.s.runs ? unfinished(r.s) : undefined}>{r.s.runs || dash}</td>
                {td(r.avg, best.avg, fmtClock)}
                {td(r.s.best, best.best, fmtClock)}
                {td(r.avgKills, best.avgKills, fmtNumber)}
                {td(r.rate, best.rate, fmtNumber)}
                {td(r.events, best.events, perRun)}
                {td(r.finds, best.finds, perRun)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </section>
  );
}

const PAGE_SIZE = 25;
const FILTER_KEY = 'horazon.runFilter';

/** The run list's filter, remembered in this browser. */
function useRunFilter() {
  const [filter, setFilter] = useState<RunFilter>(() => {
    try {
      return { ...NO_FILTER, ...(JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}') as Partial<RunFilter>) };
    } catch {
      return NO_FILTER;
    }
  });
  const update = (change: Partial<RunFilter>) =>
    setFilter((f) => {
      const next = { ...f, ...change };
      try {
        localStorage.setItem(FILTER_KEY, JSON.stringify(next));
      } catch {
        // storage blocked: the filter lasts until reload
      }
      return next;
    });
  return [filter, update] as const;
}

function RunList({
  runs,
  children,
  characters,
  focus,
}: {
  runs: MapRun[];
  children: Map<number, MapRun[]>;
  characters: Character[];
  focus: number | null;
}) {
  const [saved, update] = useRunFilter();
  // The character filter only applies while several characters' runs are listed.
  const filter = characters.length ? saved : { ...saved, character: '' };
  const [page, setPage] = useState(0);
  const values = useValues();
  const grail = useRunGrail(runs, children);
  const shown = useMemo(() => filterRuns(runs, filter, values), [runs, filter, values]);
  const byName = new Map(characters.map((c) => [c.name, c]));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const at = Math.min(page, pages - 1);
  const set = (change: Partial<RunFilter>) => {
    update(change);
    setPage(0);
  };
  // A linked run (a Horazon run sits under its map's row): to its page, clearing a filter that hides it.
  const top = [...children.values()].flat().find((c) => c.id === focus)?.parent_id ?? focus;
  useFocusOnce(focus, runs.some((r) => r.id === top), () => {
    let i = shown.findIndex((r) => r.id === top);
    if (i < 0) {
      const all = { ...NO_FILTER, sort: filter.sort, reversed: filter.reversed };
      set(all);
      i = filterRuns(runs, all, values).findIndex((r) => r.id === top);
    }
    setPage(Math.floor(Math.max(0, i) / PAGE_SIZE));
  });

  // Only choices some run has: its maps, events and added monsters.
  const options = useMemo(() => {
    const maps = new Map<string, { name: string; tier: string | null; n: number }>();
    for (const r of runs) {
      if (!r.map_code) continue;
      const m = maps.get(r.map_code) ?? { ...runMapLabel(r), n: 0 };
      maps.set(r.map_code, { ...m, n: m.n + 1 });
    }
    return {
      maps: [...maps].sort(([, a], [, b]) => (a.tier ?? '').localeCompare(b.tier ?? '') || a.name.localeCompare(b.name)),
      events: EVENTS.filter((e) => runs.some((r) => r.events.some((x) => x.kind === e.kind))),
      content: Object.keys(CONTENT_LABEL).filter((c) => runs.some((r) => r.map_stats?.some((m) => m.stat === c))),
      tiers: MAP_TIERS.filter((t) => runs.some((r) => runTier(r.map_code, r.map_quality) === t)),
      corrupted: runs.some((r) => r.map_stats?.some((m) => m.stat === 'corrupted')),
    };
  }, [runs]);

  const desc = RUN_SORTS[filter.sort].desc !== filter.reversed;
  // Column headers sort: a new column sorts best-first, the active one flips.
  const sortBy = (key: RunSort) => set(key === filter.sort ? { reversed: !filter.reversed } : { sort: key, reversed: false });
  const head = (key: RunSort | null, text: string, align = 'text-right', title?: string) =>
    key === null ? (
      <span className={align}>{text}</span>
    ) : (
      <button
        className={`${align} hover:text-text ${filter.sort === key ? 'text-accent' : ''}`}
        onClick={() => sortBy(key)}
        title={title ?? `Sort by ${RUN_SORTS[key].label.toLowerCase()}`}
        aria-pressed={filter.sort === key}
      >
        {text}
        {filter.sort === key && <span aria-label={desc ? ' highest first' : ' lowest first'}>{desc ? ' ↓' : ' ↑'}</span>}
      </button>
    );
  const tierCount = (t: string) => runs.filter((r) => runTier(r.map_code, r.map_quality) === t).length;

  return (
    <section className="flex flex-col gap-3">
      {/* One control row: heading, tier filter, then the selects (wrapping on narrow windows). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="mr-2 text-lg text-text">Runs</h2>
        {options.tiers.length > 1 && (
          <Segmented
            label="Tier"
            total={runs.length}
            options={options.tiers.map((t) => ({ key: t, label: t === 'Unique' ? 'Unique' : t, count: tierCount(t), className: t === 'Unique' ? 'text-q-unique' : undefined }))}
            active={filter.tiers}
            onToggle={(t) => set({ tiers: filter.tiers.includes(t) ? filter.tiers.filter((x) => x !== t) : [...filter.tiers, t] })}
            onClear={() => set({ tiers: [] })}
          />
        )}
      {runs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select className={select} value={filter.map} onChange={(e) => set({ map: e.target.value })} aria-label="Map">
            <option value="">All maps</option>
            {options.maps.map(([code, m]) => (
              <option key={code} value={code}>
                {m.tier ? `${m.tier} ` : ''}
                {m.name} ({m.n})
              </option>
            ))}
          </select>
          <select className={select} value={filter.event} onChange={(e) => set({ event: e.target.value })} aria-label="Events">
            <option value="">Any events</option>
            <option value="some">With an event</option>
            <option value="none">Without events</option>
            {options.events.map((e) => (
              <option key={e.kind} value={e.kind}>
                {e.label}
              </option>
            ))}
          </select>
          {options.content.length > 0 && (
            <select className={select} value={filter.content} onChange={(e) => set({ content: e.target.value })} aria-label="Monsters">
              <option value="">Any monsters</option>
              {options.content.map((c) => (
                <option key={c} value={c}>
                  {CONTENT_LABEL[c]}
                </option>
              ))}
            </select>
          )}
          {characters.length > 0 && (
            <select className={select} value={filter.character} onChange={(e) => set({ character: e.target.value })} aria-label="Character">
              <option value="">All characters</option>
              {characters.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {options.corrupted && (
            <label className="flex items-center gap-1.5 px-1 text-xs text-muted hover:text-text">
              <input type="checkbox" checked={filter.corrupted} onChange={() => set({ corrupted: !filter.corrupted })} />
              Corrupted only
            </label>
          )}
          {isFiltered(filter) && (
            <button className="text-xs text-accent hover:underline" onClick={() => set({ ...NO_FILTER, sort: filter.sort, reversed: filter.reversed })}>
              Clear
            </button>
          )}
          {/* Narrow windows have no column headers to sort by. */}
          <span className="ml-auto flex items-center gap-1 text-xs text-muted md:hidden">
            Sort
            <select className={select} value={filter.sort} onChange={(e) => set({ sort: e.target.value as RunSort, reversed: false })}>
              {Object.entries(RUN_SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </span>
        </div>
      )}
      </div>
      <div className="rounded-sm border border-line bg-panel">
      {shown.length > 0 && (
        <div className={`${RUN_COLUMNS} hidden border-b border-line/60 px-4 py-1.5 text-xs text-muted md:grid`}>
          {head('newest', 'Started', 'text-left')}
          <span>
            Map <span className="text-faint">·</span> {head('finds', 'Notable', 'text-left', 'Sort by notable: tiered items, Pul+ runes and valuable currency')}
          </span>
          {head('density', 'Density')}
          {head('boss', 'Boss')}
          {head('time', 'Time')}
          {head('kills', 'Kills')}
          {head('rate', 'Kills/min')}
          {head('clear', 'Clear')}
          <span />
        </div>
      )}
      {shown.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">{runs.length ? 'No runs match these filters.' : 'No maps run in this period.'}</p>
      ) : (
        <ul>
          {shown.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE).map((r) => (
            <li key={r.id} className="border-b border-line/60 last:border-0">
              <RunRow
                run={r}
                focused={r.id === focus}
                entered={(children.get(r.id) ?? []).length > 0}
                character={characters.length && r.character ? { name: r.character, cls: byName.get(r.character)?.class ?? null, ladder: r.ladder ?? byName.get(r.character)?.ladder ?? null } : undefined}
                grail={grail}
              />
              {(children.get(r.id) ?? []).map((c) => (
                <div key={c.id} className="border-t border-dashed border-line/60">
                  <RunRow run={c} parent={r} grail={grail} focused={c.id === focus} />
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-muted">
          <span className="tabular-nums">
            {at * PAGE_SIZE + 1}–{Math.min(shown.length, (at + 1) * PAGE_SIZE)} of {shown.length}
            {shown.length < runs.length && ` (${runs.length} in this period)`}
          </span>
          {pages > 1 && <Pager page={at} pages={pages} onPage={setPage} />}
        </div>
      )}
      </div>
    </section>
  );
}

/** Column labels for runs listed inside another table (an expanded map). */
function RunHeader() {
  return (
    <div className={`${RUN_COLUMNS} hidden border-b border-line/60 px-4 py-1 text-xs text-faint md:grid`}>
      <span>Started</span>
      <span>Run · notable</span>
      <span className="text-right">Density</span>
      <span className="text-right">Boss</span>
      <span className="text-right">Time</span>
      <span className="text-right">Kills</span>
      <span className="text-right">Kills/min</span>
      <span className="text-right">Clear</span>
      <span />
    </div>
  );
}

/** Column labels for a zone's runs: what a zone has (no density, boss or clear). */
function ZoneRunHeader() {
  return (
    <div className={`${ZONE_COLUMNS} hidden border-b border-line/60 px-4 py-1 text-xs text-faint md:grid`}>
      <span>Started</span>
      <span>Run · notable</span>
      <span className="text-center">Corrupted</span>
      <span className="text-right">Time</span>
      <span className="text-right">Kills</span>
      <span className="text-right">Kills/min</span>
      <span className="text-right">Shards</span>
      <span />
    </div>
  );
}

/**
 * First-time grail finds by run ("runId|name"): each find goes to the latest run before it that
 * dropped an item of that name. Listed on the run with the sparkle, not counted as notable.
 */
export function useRunGrail(runs: MapRun[], children: Map<number, MapRun[]>): Set<string> {
  const [found, setFound] = useState<GrailFound[]>([]);
  const version = useChanges('drops');
  useEffect(() => {
    fetchGrail().then(setFound, () => {});
  }, [version]);
  return useMemo(() => {
    const all = [...runs, ...[...children.values()].flat()].sort((a, b) => b.started_at.localeCompare(a.started_at));
    const out = new Set<string>();
    for (const g of found) {
      if (g.baseline) continue;
      const at = new Date(g.found_at).getTime();
      const r = all.find((r) => new Date(r.started_at).getTime() <= at && r.items.some((i) => captureName(i) === g.name));
      if (r) out.add(`${r.id}|${g.name}`);
    }
    return out;
  }, [found, runs, children]);
}

/** A run in a list: a map's (the Log's columns) or, with `zone`, a zone's (ZONE_COLUMNS). */
function RunRow({
  run,
  parent,
  entered,
  character,
  grail,
  zone = false,
  focused = false,
}: {
  run: MapRun;
  parent?: MapRun;
  entered?: boolean;
  character?: { name: string; cls: string | null; ladder?: boolean | null };
  grail?: Set<string>;
  zone?: boolean;
  focused?: boolean;
}) {
  const focusRow = useFocusedRow(focused);
  const label = runMapLabel(run, parent);
  const values = useValues();
  const events = run.events.filter((e) => e.kind in EVENT_LABEL);
  // Rewards an event claims (keys from a Spire...) show with the event, not as finds.
  const claimed = (code: string) => events.some((e) => EVENT_REWARDS[e.kind]?.match(code));
  // Bought from Gheed: shown with his event, not again as finds (each purchase hides one item).
  const bought = events.flatMap((e) => e.data?.shop?.filter((s) => s.bought && s.uid != null) ?? []);
  const fromShop = (i: (typeof run.items)[number]) => {
    const k = bought.findIndex((s) => s.uid === i.uid && (i.quality === 'unique' || i.quality === 'set'));
    if (k >= 0) bought.splice(k, 1);
    return k >= 0;
  };
  const isGrail = (i: (typeof run.items)[number]) => !!grail?.has(`${run.id}|${captureName(i)}`);
  const items = run.items.filter((i) => (isNotableFind(i, values) || isGrail(i)) && !claimed(i.code) && !fromShop(i));
  const defeated = run.events.some((e) => e.kind === 'horazon_portal');
  const density = mapDensity(run);
  // Fortified shows with the craft marks, not twice.
  const content = mapContent(run.map_stats).filter((m) => !MAP_CRAFT_STATS.has(m.stat));
  // The map's properties and the finds' affixes show on hover, like in the drops list.
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const hasMods = run.kind === 'map' && ((run.map_stats?.length ?? 0) > 0 || run.map_mods.length > 0);
  const hoverOn = (item: Item) => ({
    onMouseMove: (e: React.MouseEvent) => setHover({ item, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setHover(null),
  });
  const remove = () => {
    const what = `${label.name} from ${startFmt.format(new Date(run.started_at))}`;
    if (!confirm(`Delete the run ${what}?\n\nIt no longer counts for map stats or the kill counter's estimates and comparisons. The data is backed up first.`)) return;
    setDeleteError(null);
    deleteRun(run.id).catch((e: Error) => setDeleteError(e.message));
  };
  const [deleteError, setDeleteError] = useState<string | null>(null);
  return (
    <div ref={focusRow.ref} className={`group flex flex-col gap-1.5 px-4 py-2.5 ${focusRow.mark}`}>
      <div className={`${zone ? ZONE_COLUMNS : RUN_COLUMNS} items-center`}>
        <span className="min-w-0 text-xs text-muted tabular-nums">
          {startFmt.format(new Date(run.started_at))}
          {character && (
            <span className="mt-0.5 flex items-center gap-1 truncate text-xs" title={character.name}>
              <ClassIcon cls={character.cls} size={14} />
              {character.name}
              {character.ladder === false && <NonLadderTag />}
            </span>
          )}
        </span>
        <span className="min-w-0">
          {parent && <span className="mr-1.5 text-muted">↳</span>}
          {label.tier && <span className="mr-2 text-xs text-muted">{label.tier}</span>}
          <span className={`${label.color} ${hasMods ? 'cursor-help' : ''}`} {...(hasMods ? hoverOn(mapItem(run, label.name, label.tier)) : {})}>
            {label.name}
          </span>
          <MapCrafts stats={run.map_stats} className="ml-2 -translate-y-px align-middle" />
          {content.length > 0 && (
            <span className="ml-2 inline-flex translate-y-[3px] gap-1">
              {content.map((m) => (
                <EventIcon key={m.stat} kind={m.stat} size={18} title={m.label} />
              ))}
            </span>
          )}
          {zone && playerDeaths(run) > 0 && (
            <span className="ml-2 inline-flex items-center gap-0.5 align-[-3px] text-q-red" title={`You died ${playerDeaths(run) === 1 ? 'once' : `${playerDeaths(run)} times`} in this run`}>
              <EventIcon kind="death" title="Deaths" />
              {playerDeaths(run) > 1 && <span className="text-xs">{playerDeaths(run)}</span>}
            </span>
          )}
        </span>
        {zone ? (
          <span className="flex justify-center">
            {run.corrupted && <EventIcon kind="corrupted" size={16} title="Corrupted zone (from the game's “Corruption spreads in ...” notice)" className="text-q-red" />}
          </span>
        ) : (
        <>
        <span className="text-right text-sm tabular-nums" title="Monster Density of the map">
          {density !== null && (
            <span className="font-semibold" style={{ color: densityColor(density) }}>
              {density > 0 ? '+' : ''}
              {density}%
            </span>
          )}
        </span>
        <span className="flex items-center justify-end gap-1 text-sm tabular-nums">
          {run.boss && run.boss_seconds !== null && (
            <span className="flex items-center gap-1 text-q-set" title={`${run.boss} killed at ${fmtClock(run.boss_seconds)} (time inside the map)`}>
              <EventIcon kind="boss" className="text-q-set" title={run.boss} />
              {fmtClock(run.boss_seconds)}
            </span>
          )}
          {playerDeaths(run) > 0 && (
            <span className="flex items-center gap-0.5 text-q-red" title={`You died ${playerDeaths(run) === 1 ? 'once' : `${playerDeaths(run)} times`} in this run`}>
              <EventIcon kind="death" title="Deaths" />
              {playerDeaths(run) > 1 && <span className="text-xs">{playerDeaths(run)}</span>}
            </span>
          )}
          {run.boss && bossSkipped(run) && (
            <span className="flex items-center gap-1 text-muted" title={`${run.boss} did not die in this run`}>
              <EventIcon kind="boss" className="opacity-50 grayscale" title={run.boss} />
              <span className="text-xs">skipped</span>
            </span>
          )}
        </span>
        </>
        )}
        <span className="text-right text-sm tabular-nums" title={zone ? 'Time inside the zone' : 'Time inside the map'}>
          {fmtClock(run.seconds)}
          {run.open && <span className="ml-1 text-xs text-q-set">live</span>}
        </span>
        <span
          className="text-right text-sm tabular-nums"
          title={
            !run.kills && !run.deaths && !run.open
              ? 'No kills captured for this run (missing, not zero)'
              : runKills(run).approx ? 'No monster deaths captured - the game\'s own kill counter, which misses some kills' : 'Monster kills inside the map'
          }
        >
          {/* Nothing captured at all is missing data, not an observed zero. */}
          {!run.kills && !run.deaths && !run.open ? (
            <span className="text-faint">—</span>
          ) : (
            <>
              {runKills(run).approx && '~'}
              {fmtNumber(runKills(run).n)}
            </>
          )}
        </span>
        <span className="flex items-center justify-end gap-2 text-sm tabular-nums" title="Monsters killed per minute, average over the run">
          {run.rate?.avg != null ? (
            <>
              <KillRateChart rate={run.rate} width={64} height={18} className="text-muted" />
              <span>{fmtRate(run.rate.avg)}</span>
            </>
          ) : (
            // Zones keep no kill curve: the plain average.
            zone && run.seconds >= 10 && <span>{fmtNumber((runKills(run).n / run.seconds) * 60)}</span>
          )}
        </span>
        {zone ? (
          <span className="text-right text-sm tabular-nums" title="Worldstone Shards that dropped">
            {run.drops.shard || <span className="text-faint">—</span>}
          </span>
        ) : (
          <span className="text-right text-sm text-muted tabular-nums" title="Share of the map's monsters killed (estimated from the best run of this map)">
            {run.clear !== null ? `${Math.round(run.clear * 100)}%` : ''}
          </span>
        )}
        <button
          // The padding (offset by a negative margin) gives the glyph a finger-sized target without widening its column.
          className="-m-2 p-2 text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-q-red focus-visible:opacity-100 disabled:invisible"
          title={run.open ? 'Still being played' : 'Delete this run'}
          aria-label={`Delete the run ${label.name} from ${startFmt.format(new Date(run.started_at))}`}
          disabled={run.open}
          onClick={remove}
        >
          ×
        </button>
      </div>
      {deleteError && (
        <p className="text-xs text-q-red md:pl-[7.5rem]" role="alert">
          Couldn't delete this run: {deleteError}. Nothing was changed; try again once the app has finished starting.
        </p>
      )}
      {events.map((e, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-xs md:pl-[7.5rem]">
          <EventIcon kind={e.kind} />
          <EventResult event={e} defeated={defeated} entered={entered} />
        </div>
      ))}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-sm md:pl-[7.5rem]">
          {items.map((i, k) => {
            const item = i.item ?? { ...asItem(i), item_level: i.ilvl ?? undefined };
            return (
              <span key={k} className="flex cursor-help items-center gap-1" {...hoverOn(item)}>
                <ItemIcon item={item} box={20} />
                <span className={itemColor(i)}>{captureName(i)}</span>
                {i.ethereal && <span className="text-muted">eth</span>}
                {isGrail(i) && <NewMark size={13} />}
              </span>
            );
          })}
        </div>
      )}
      {hover && <FloatingTooltip {...hover} />}
    </div>
  );
}

/**
 * Everything outside maps (corrupted zones, act bosses...), one row per zone: time,
 * kills, Worldstone Shards and the notable finds.
 */
type ZoneRow = { runs: MapRun[]; corrupted: MapRun[]; seconds: number; kills: number; shards: number; notable: number };
type ZoneSort = 'runs' | 'corrupted' | 'time' | 'kills' | 'rate' | 'shards' | 'notable';
const ZONE_SORTS: Sorts<ZoneSort, ZoneRow> = {
  runs: { of: (z) => z.runs.length, low: false, label: 'runs' },
  corrupted: { of: (z) => z.corrupted.length, low: false, label: 'corrupted runs' },
  time: { of: (z) => z.seconds, low: false, label: 'time' },
  kills: { of: (z) => z.kills, low: false, label: 'kills' },
  rate: { of: (z) => (z.seconds ? (z.kills / z.seconds) * 60 : null), low: false, label: 'kills per minute' },
  shards: { of: (z) => z.shards, low: false, label: 'shards' },
  notable: { of: (z) => z.notable, low: false, label: 'notable' },
};
const ZONE_HEADS: Record<ZoneSort, string> = { runs: 'Runs', corrupted: 'Corrupted', time: 'Time', kills: 'Kills', rate: 'Kills/min', shards: 'Shards', notable: 'Notable' };

export function ZoneOverview({ runs: all, characters = [], focus = null }: { runs: MapRun[]; characters?: Character[]; focus?: number | null }) {
  const values = useValues();
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState<ZoneSort>>({ key: 'time', flip: false });
  const zoneRuns = useMemo(() => all.filter((r) => r.kind === 'zone'), [all]);
  const noChildren = useMemo(() => new Map<number, MapRun[]>(), []);
  const grail = useRunGrail(zoneRuns, noChildren);
  const zones = useMemo(() => {
    // One row per zone; corruption is marked on each run (it changes game to game).
    const groups = new Map<string, MapRun[]>();
    for (const r of zoneRuns) groups.set(String(r.area), [...(groups.get(String(r.area)) ?? []), r]);
    return [...groups.entries()]
      .map(([key, runs]) => ({
        key,
        area: runs[0].area,
        runs: runs.sort((a, b) => b.started_at.localeCompare(a.started_at)),
        seconds: runs.reduce((n, r) => n + r.seconds, 0),
        kills: runs.reduce((n, r) => n + runKills(r).n, 0),
        shards: runs.reduce((n, r) => n + (r.drops.shard ?? 0), 0),
        corrupted: runs.filter((r) => r.corrupted),
        notable: runs.reduce((n, r) => n + r.items.filter((i) => isNotableFind(i, values)).length, 0),
      }))
      .sort((a, b) => b.seconds - a.seconds);
  }, [zoneRuns, values]);
  const sorted = sortRows(zones, ZONE_SORTS, sort);
  // A linked run: its zone opened, on the page holding it.
  useFocusOnce(focus, zoneRuns.some((r) => r.id === focus), () => {
    const z = zones.find((x) => x.runs.some((r) => r.id === focus))!;
    setOpen(z.key);
    setPage(Math.floor(z.runs.findIndex((r) => r.id === focus) / PAGE_SIZE));
  });
  if (!zones.length) return null;
  const corrupted = zoneRuns.filter((r) => r.corrupted);
  const cTime = corrupted.reduce((n, r) => n + r.seconds, 0);
  const cShards = corrupted.reduce((n, r) => n + (r.drops.shard ?? 0), 0);
  const cell = 'px-3 py-2 text-right tabular-nums';
  const dash = <span className="text-muted">—</span>;
  // The totals line Maps has; "Of which corrupted" below then qualifies it.
  const runCount = zones.reduce((n, z) => n + z.runs.length, 0);
  const time = zones.reduce((n, z) => n + z.seconds, 0);
  const kills = zones.reduce((n, z) => n + z.kills, 0);
  const shards = zones.reduce((n, z) => n + z.shards, 0);
  const notable = zones.reduce((n, z) => n + z.notable, 0);
  const toggle = (key: string) => {
    setOpen((o) => (o === key ? null : key));
    setPage(0);
  };
  const COLS = 8;
  return (
    <>
    <Ledger
      items={[
        { value: fmtNumber(runCount), label: runCount === 1 ? 'zone run' : 'zone runs' },
        { value: fmtClock(time), label: 'time' },
        { value: fmtNumber(kills), label: 'kills' },
        ...(time >= 60 ? [{ value: fmtNumber(kills / (time / 60)), label: 'kills / min' }] : []),
        ...(shards ? [{ value: fmtNumber(shards), label: shards === 1 ? 'shard' : 'shards' }] : []),
        { value: fmtNumber(notable), label: 'notable', title: 'Notable finds in zones: tiered items, Pul+ runes and valuable currency' },
      ]}
    />
    <section className="flex flex-col gap-3">
      {/* The corrupted-zone totals sit right above the table they sum. */}
      <header className="flex flex-col gap-1">
        <h2 className="text-lg text-text">Zones</h2>
        {corrupted.length > 0 ? (
          <span className="flex items-center gap-1 text-xs text-muted">
            <EventIcon kind="corrupted" size={14} className="text-q-red" title="Corrupted zones" />
            Of which corrupted: <span className="text-text tabular-nums">{fmtClock(cTime)}</span> ·{' '}
            <span className="text-text tabular-nums">{fmtNumber(corrupted.reduce((n, r) => n + runKills(r).n, 0))}</span> kills ·{' '}
            <span className="text-text tabular-nums">{cShards}</span> shard{cShards === 1 ? '' : 's'}
            {cTime >= 600 && <> · <span className="text-text tabular-nums">{(cShards / (cTime / 3600)).toFixed(1)}</span> per hour</>}
          </span>
        ) : (
          <span className="text-xs text-muted">Outside maps: corrupted zones, act bosses, farming spots</span>
        )}
      </header>
      <div className="rounded-sm border border-line bg-panel">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-2 text-left font-normal">Zone</th>
              {(Object.keys(ZONE_SORTS) as ZoneSort[]).map((k) => (
                <SortHead
                  key={k}
                  k={k}
                  text={ZONE_HEADS[k]}
                  sorts={ZONE_SORTS}
                  sort={sort}
                  onSort={setSort}
                  title={k === 'corrupted' ? "Sort by corrupted runs (from the game's “Corruption spreads in ...” notice)" : undefined}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((z) => {
              const on = open === z.key;
              const pages = Math.max(1, Math.ceil(z.runs.length / PAGE_SIZE));
              const at = Math.min(page, pages - 1);
              return (
                <Fragment key={z.key}>
                  <tr className={`cursor-pointer border-b border-line/60 ${on ? 'bg-panel-hi' : 'hover:bg-panel-hi/60'}`} onClick={() => toggle(z.key)}>
                    <td className="py-1.5 pr-3 pl-3">
                      <button className="flex items-center gap-2 text-left" aria-expanded={on} onClick={(e) => (e.stopPropagation(), toggle(z.key))}>
                        <span className="inline-block w-3 text-muted" aria-hidden>
                          {on ? '▾' : '▸'}
                        </span>
                        {areaName(z.area)}
                      </button>
                    </td>
                    <td className={cell}>{z.runs.length}</td>
                    <td className={cell}>
                      {z.corrupted.length ? (
                        <span className="inline-flex items-center gap-1 text-q-red" title="Runs while the zone was corrupted">
                          <EventIcon kind="corrupted" size={14} title="Corrupted runs" className="text-q-red" />
                          {z.corrupted.length}
                        </span>
                      ) : (
                        dash
                      )}
                    </td>
                    <td className={cell}>{fmtClock(z.seconds)}</td>
                    <td className={cell}>{fmtNumber(z.kills)}</td>
                    <td className={cell}>{z.seconds ? fmtNumber((z.kills / z.seconds) * 60) : dash}</td>
                    <td className={cell}>{z.shards || dash}</td>
                    <td className={cell}>{z.notable || dash}</td>
                  </tr>
                  {on && (
                    <tr className="border-b border-line">
                      <td colSpan={COLS} className="bg-bg/40 p-0">
                        {/* Each run with its own finds, as a map opens to its runs: a zone farmed fifty times stays one row. */}
                        <ZoneRunHeader />
                        <ul>
                          {z.runs.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE).map((r) => (
                            <li key={r.id} className="border-b border-line/60 last:border-0">
                              <RunRow
                                run={r}
                                zone
                                focused={r.id === focus}
                                grail={grail}
                                // Each run names who ran it, with the class icon.
                                character={r.character ? { name: r.character, cls: characters.find((c) => c.name === r.character)?.class ?? null, ladder: r.ladder ?? null } : undefined}
                              />
                            </li>
                          ))}
                        </ul>
                        {pages > 1 && (
                          <div className="flex justify-end border-t border-line/60 px-4 py-2 text-xs">
                            <Pager page={at} pages={pages} onPage={setPage} />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
      <p className="text-xs text-muted">Shards: Worldstone Shards that dropped · Notable: tiered items, Pul+ runes and valuable currency · open a zone for its runs and what each found</p>
    </section>
    </>
  );
}

export function CaptureHowTo() {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-panel px-5 py-4 text-sm">
      <h2 className="text-text">No game data yet</h2>
      <p className="text-muted">
        Kills, map runs, times and events come from the game capture, which reads the game connection on this
        machine. It starts with the game (tray → Capture); play a game and it shows up here.
      </p>
    </div>
  );
}
