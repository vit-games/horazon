import { BossOverview, buildFights } from '../components/BossOverview';
import { Pager } from '../components/Pager';
import { useEffect, useMemo, useState } from 'react';
import { ActivityCalendar, type CalendarMetric } from '../components/ActivityCalendar';
import { CurrencyTable } from '../components/CurrencyTable';
import { Figures } from '../components/Figures';
import { Ledger } from '../components/Ledger';
import { RuneStash } from '../components/RuneStash';
import { CharacterPicker } from '../components/CharacterPicker';
import { ItemIcon } from '../components/ItemIcon';
import { CaptureHowTo, MapOverview, ZoneOverview, focusFromHash } from '../components/MapSections';
import { DropsTabs } from './DropsView';
import { allSessions } from './SessionView';
import { dayLabel, formatTime } from '../lib/time';
import { currencyLabel } from '../lib/currencyDrops';
import { Seg } from '../components/Seg';
import { fetchDrops, fetchStats, rangeParams, type Range } from '../lib/api';
import {
  fetchCaptureGames,
  fetchCaptureStatus,
  fetchRuns,
  isShard,
  mapInfo,
  type CaptureGame,
  type CaptureStatus,
  type MapRun,
} from '../lib/capture';
import { CURRENCY_CODES, nameColor } from '../lib/itemStyle';
import { useChanges } from '../lib/live';
import { PUL, RUNE_NAMES, TIER_RANGE, runeNumber } from '../lib/runes';
import { isNotable, rankScore } from '../lib/rank';
import { tierOf } from '../lib/tiers';
import { useValues } from '../lib/values';
import { fmtCompact, fmtDuration, fmtNumber, gained, seriesFor, sumSeries, valueAt, type Point } from '../lib/series';
import type { Drop, StatsResponse } from '../lib/types';
import { toolbar as input } from '../lib/ui';

const TRACK_KEY = 'pd2lt.trackRune';

function loadTrackRune(): number {
  try {
    const v = Number(localStorage.getItem(TRACK_KEY));
    if (v >= 1 && v <= 33) return v;
  } catch {}
  return PUL;
}

const fullFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

interface Gap {
  drop: Drop;
  t: number;
  kills: number | null;
  maps: number | null;
}

/**
 * Lifetime counter preferring captured games: `.kills` readings only up to the first
 * captured game (they set the lifetime starting point), then the games' running total.
 */
function captureFirst(readings: Point[], games: CaptureGame[], value: (g: CaptureGame) => number): Point[] {
  if (!games.length) return readings;
  const start = new Date(games[0].started_at).getTime();
  const before = readings.filter((p) => p.t <= start);
  const base = before.at(-1)?.v ?? 0;
  return [...before, ...cumulative(games, value).map((p) => ({ ...p, v: base + p.v }))];
}

/** Map runs counted one by one (the runs listed in the maps table), oldest first. */
function runCounter(runs: MapRun[]): Point[] {
  const sorted = runs.map((r) => new Date(r.started_at).getTime()).sort((a, b) => a - b);
  return sorted.length ? [{ t: sorted[0], v: 0, approx: false }, ...sorted.map((t, i) => ({ t, v: i + 1, approx: false }))] : [];
}

/**
 * Cumulative counter over captured games (the game's kill counter restarts every game):
 * 0 at the first game's start, then the running total at each game's end.
 */
function cumulative(games: CaptureGame[], value: (g: CaptureGame) => number): Point[] {
  if (!games.length) return [];
  const points: Point[] = [{ t: new Date(games[0].started_at).getTime(), v: 0, approx: false }];
  let total = 0;
  for (const g of games) {
    total += value(g);
    points.push({ t: new Date(g.ended_at).getTime(), v: total, approx: false });
  }
  return points;
}

// Runs: Maps first and by default, map runs are the core of Horazon.
const SUBTABS = [
  { key: 'maps', label: 'Maps' },
  { key: 'zones', label: 'Zones' },
  { key: 'bossing', label: 'Bossing' },
] as const;
type Subtab = (typeof SUBTABS)[number]['key'] | 'overview' | 'currency';

/** `#runs/zones` (or `#runs/zones/<run id>`) -> 'zones'; anything else on Runs is Maps. */
const subtabFromHash = (): Subtab => SUBTABS.find((s) => location.hash.split('/')[1] === s.key)?.key ?? 'maps';

const ALL_KEY = 'horazon.progress.allCharacters';

const HEAT_METRICS: { key: CalendarMetric; label: string }[] = [
  { key: 'kills', label: 'Kills' },
  { key: 'maps', label: 'Maps' },
  { key: 'drops', label: 'Drops' },
  { key: 'shards', label: 'Shards' },
];

/**
 * One data load, three places: the Runs tab (Maps, Zones, Bossing), the Activity tab (the
 * season's totals, per-day charts and calendar) and Drops → Currency.
 */
export function ProgressView({ range, section, title }: { range: Range; section: 'runs' | 'activity' | 'currency'; title?: string }) {
  const since = range.since;
  const [character, setCharacter] = useState<string | null>(null);
  // Every character together ("All"), remembered in this browser.
  const [allChars, setAllChars] = useState(() => {
    try {
      return localStorage.getItem(ALL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [drops, setDrops] = useState<Drop[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackRune, setTrackRune] = useState(loadTrackRune);
  const [heatMetric, setHeatMetric] = useState<CalendarMetric>('kills');
  // The calendar day whose sessions are listed under it.
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const [runsTab, setRunsTab] = useState<Subtab>(subtabFromHash);
  const [focus, setFocus] = useState(focusFromHash);
  const subtab: Subtab = section === 'runs' ? runsTab : section === 'activity' ? 'overview' : 'currency';
  const [runs, setRuns] = useState<MapRun[]>([]);
  const [games, setGames] = useState<CaptureGame[]>([]);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const version = useChanges('stats', 'drops', 'runs');

  useEffect(() => {
    try {
      localStorage.setItem(TRACK_KEY, String(trackRune));
    } catch {}
  }, [trackRune]);

  // All-time data: gaps between drops and range deltas need readings from before the range.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const all = { since: null, until: null };
    Promise.all([fetchStats(allChars ? '*' : character), fetchDrops(all), fetchRuns(all), fetchCaptureGames(), fetchCaptureStatus()])
      .then(([s, d, r, g, st]) => {
        if (cancelled) return;
        setStats(s);
        setDrops(d);
        setRuns(r.runs);
        setGames(g);
        setStatus(st);
        setError(null);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [character, allChars, version]);

  useEffect(() => {
    const onHash = () => {
      setRunsTab(subtabFromHash());
      setFocus(focusFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The live indicator ages even when nothing changes.
  useEffect(() => {
    const t = setInterval(() => fetchCaptureStatus().then(setStatus, () => {}), 20_000);
    return () => clearInterval(t);
  }, []);

  const current = stats?.character ?? null;
  // A season's progress is the ladder characters': "All" leaves non-ladder ones out (picking one still shows it).
  const seasonal = since !== null;
  const nonLadder = useMemo(() => new Set((stats?.characters ?? []).filter((c) => c.ladder === false).map((c) => c.name)), [stats]);
  /** Whether a game, run or drop of this character is shown: the picked one, or any counted with "All". */
  const mine = (c: string | null) => (allChars ? !(seasonal && c !== null && nonLadder.has(c)) : c === current);
  const myGames = useMemo(() => games.filter((g) => mine(g.character)), [games, current, allChars, seasonal, nonLadder]);
  const captured = myGames.length > 0;
  const myMapRuns = useMemo(() => runs.filter((r) => mine(r.character) && r.kind === 'map'), [runs, current, allChars, seasonal, nonLadder]);
  // Lifetime counters per character, summed with "All", from captured games. Readings from the
  // chat log (no longer read, kept from older versions) give the totals before the first captured
  // game; maps are the captured runs (the maps table), `.kills maps` readings only for a character without any.
  const { kills, maps, deaths, played } = useMemo(() => {
    const samples = stats?.samples ?? [];
    const names = allChars
      ? [...new Set([...samples.map((s) => s.character), ...games.map((g) => g.character), ...runs.map((r) => r.character)])].filter(
          (c): c is string => !!c && mine(c),
        )
      : [current];
    const per = names.map((name) => {
      const own = allChars ? samples.filter((s) => s.character === name) : samples;
      const theirRuns = runs.filter((r) => r.character === name && r.kind === 'map');
      const theirGames = games.filter((g) => g.character === name);
      return {
        kills: captureFirst(seriesFor(own, 'monster_kills'), theirGames, (g) => g.deaths || g.kills),
        maps: theirRuns.length ? runCounter(theirRuns) : seriesFor(own, 'map_boss_kills'),
        deaths: captureFirst(seriesFor(own, 'deaths'), theirGames, (g) => g.died),
        played: captureFirst(seriesFor(own, 'time_played'), theirGames, (g) => (new Date(g.ended_at).getTime() - new Date(g.started_at).getTime()) / 1000),
      };
    });
    return {
      kills: sumSeries(per.map((p) => p.kills)),
      maps: sumSeries(per.map((p) => p.maps)),
      deaths: sumSeries(per.map((p) => p.deaths)),
      played: sumSeries(per.map((p) => p.played)),
    };
  }, [stats, games, runs, current, allChars, seasonal, nonLadder]);

  // Tracked rune drops, oldest first, with kill/map counters at each drop.
  const tracked = useMemo(() => {
    return (drops ?? [])
      .filter((d) => mine(d.character) && (runeNumber(d.item) ?? 0) >= trackRune)
      .map((d) => ({ drop: d, t: new Date(d.found_at).getTime() }))
      .sort((a, b) => a.t - b.t);
  }, [drops, current, allChars, seasonal, nonLadder, trackRune]);

  const now = Math.min(Date.now(), range.until?.getTime() ?? Infinity);
  const from = since?.getTime() ?? null;
  // Zoom to where data exists inside the selected range (a new character may only have minutes of readings).
  const dataStart = Math.min(kills[0]?.t ?? now, maps[0]?.t ?? now, tracked[0]?.t ?? now);

  const gaps: Gap[] = tracked.map(({ drop, t }, i) => {
    const prev = tracked[i - 1];
    const diff = (series: typeof kills) => {
      if (!prev) return null;
      const a = valueAt(series, prev.t);
      const b = valueAt(series, t);
      return a === null || b === null ? null : b - a;
    };
    return { drop, t, kills: diff(kills), maps: diff(maps) };
  });
  const gapsInRange = gaps.filter((g) => (from === null || g.t >= from) && g.t <= now);
  const trackedCount = gapsInRange.reduce((n, g) => n + g.drop.quantity, 0);

  const killsGained = gained(kills, from, now);
  const mapsGained = gained(maps, from, now);
  const deathsGained = gained(deaths, from, now);
  const playedGained = gained(played, from, now);

  const last = tracked.filter((d) => d.t <= now).at(-1);
  const sinceLast = (series: typeof kills) => {
    if (!last || !series.length) return null;
    const at = valueAt(series, last.t);
    const end = valueAt(series, now);
    return at === null || end === null ? null : end - at;
  };
  const droughtKills = sinceLast(kills);
  const droughtMaps = sinceLast(maps);

  const inRange = (t: string) => {
    const ms = new Date(t).getTime();
    return (from === null || ms >= from) && ms <= now;
  };
  const myRuns = runs.filter((r) => mine(r.character) && inRange(r.started_at));
  // A linked run of another character than the one shown: show its character (not kept as your pick).
  const focusRun = section === 'runs' && focus !== null ? runs.find((r) => r.id === focus) : undefined;
  useEffect(() => {
    if (focusRun?.character && !mine(focusRun.character)) {
      setAllChars(false);
      setCharacter(focusRun.character);
    }
  }, [focusRun?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickCharacter = (name: string) => {
    const all = name === '';
    setAllChars(all);
    try {
      localStorage.setItem(ALL_KEY, all ? '1' : '0');
    } catch {}
    if (!all) setCharacter(name);
  };
  const myDrops = useMemo(() => (drops ?? []).filter((d) => mine(d.character)), [drops, current, allChars, seasonal, nonLadder]);
  // The maps comparison by character still shows non-ladder characters' clears.
  const compareRuns = allChars ? runs.filter((r) => inRange(r.started_at)) : myRuns;
  // Currency tab: runes (per rune) and valuable currency found in the period.
  const foundInRange = myDrops.filter((d) => inRange(d.found_at));
  const currencyFound = foundInRange.filter((d) => CURRENCY_CODES.has(d.item.base_code));


  // Worldstone Shards picked up (counted whether or not the drop list shows them).
  const shards = myDrops.filter((d) => isShard(d.item.base_code) && inRange(d.found_at)).reduce((n, d) => n + d.quantity, 0);
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const shardsToday = myDrops
    .filter((d) => isShard(d.item.base_code) && new Date(d.found_at).getTime() >= todayStart)
    .reduce((n, d) => n + d.quantity, 0);
  const characters = [...new Set([...(stats?.characters ?? []).map((c) => c.name), ...games.map((g) => g.character).filter((c): c is string => !!c)])];

  const trackName = RUNE_NAMES[trackRune - 1];
  const markerLabel = trackRune === 1 ? 'Rune drop' : `${trackName}+ rune drop`;


  // At the foot, as on Drops: the stat readings behind these figures.
  const exportLine = (
    <p className="text-xs text-muted">
      Export the stat readings as{' '}
      <a className="text-accent hover:underline" href={`/api/export/stats.csv?${rangeParams(range)}`}>
        CSV
      </a>
      .
    </p>
  );

  // Under Drops the Drops tabs stay put while this loads (or has nothing to show).
  const early = error ? (
    <div className="rounded-sm border border-q-red/50 bg-q-red/10 px-3 py-2 text-sm text-q-red">{error}</div>
  ) : !stats ? (
    <p className="py-16 text-center text-muted">Loading…</p>
  ) : !characters.length ? (
    <HowTo />
  ) : null;
  // Under the session the history just stays away until there is some (the session says "No games yet").
  if (section === 'activity' && !error && (early || !stats)) return null;
  if (early || !stats) return section === 'currency' ? <><DropsTabs page="currency" />{early}</> : early;

  return (
    <>
      {section === 'activity' && <h2 className="mt-4 border-t border-line pt-6 text-xl text-text">{title ?? 'History'}</h2>}
      {/* Tabs (Activity: its totals) first, the character (and what they look at) on the same line. */}
      <div
        className={`flex min-h-10 flex-wrap justify-between gap-x-6 gap-y-2 ${section === 'activity' ? 'items-center' : 'items-end border-b border-line'}`}
      >
        {section === 'activity' ? (
          <Ledger
            items={[
              { ...seasonFirst(killsGained, kills, from, fmtCompact), label: 'kills' },
              {
                ...seasonFirst(mapsGained, maps, from, fmtNumber),
                label: 'maps',
                title: myMapRuns.length ? 'Captured map runs' : 'Map boss kills',
              },
              { value: <>{fmtNumber(shards)}{shardsToday > 0 && <span className="ml-1 text-sm text-muted">({fmtNumber(shardsToday)} today)</span>}</>, label: 'Worldstone Shards' },
              { ...seasonFirst(deathsGained, deaths, from, fmtNumber), label: 'deaths' },
              { ...seasonFirst(playedGained, played, from, fmtDuration, fmtDuration), label: 'played', title: 'Time in captured games' },
            ]}
            />
        ) : section === 'currency' ? (
          <DropsTabs page="currency" className="flex gap-1 text-sm" />
        ) : (
        <nav className="flex gap-1 text-sm" aria-label="Runs">
          {SUBTABS.map((t) => (
            <a
              key={t.key}
              href={`#runs/${t.key}`}
              aria-current={subtab === t.key ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-1.5 ${subtab === t.key ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}
            >
              {t.label}
            </a>
          ))}
        </nav>
        )}
        <div className={`flex flex-wrap items-center gap-2 ${section === 'activity' ? '' : 'pb-1'}`}>
          <CharacterPicker
            characters={characters.map((name) => stats.characters.find((c) => c.name === name) ?? { name, class: null, level: null })}
            value={allChars ? '' : current ?? ''}
            onChange={pickCharacter}
            all
          />
        </div>
      </div>

      {subtab === 'overview' && (
        <>
          <SessionList
            games={myGames}
            runs={myRuns}
            drops={myDrops}
            from={from}
            day={pickedDay}
            onClearDay={() => setPickedDay(null)}
          />
          <section className="flex flex-col gap-3 rounded-sm border border-line bg-panel p-4">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm text-text">When you play</h2>
              <Seg options={HEAT_METRICS} value={heatMetric} onChange={setHeatMetric} />
            </header>
            <ActivityCalendar
              from={from}
              to={now}
              games={myGames}
              runs={myRuns}
              drops={myDrops}
              metric={heatMetric}
              dataStart={dataStart}
              readings={kills}
              picked={pickedDay}
              onPick={setPickedDay}
            />
          </section>
          <PlayRecords drops={foundInRange} />
          {exportLine}
        </>
      )}

      {subtab === 'maps' &&
        (myRuns.some((r) => r.kind === 'map' || r.kind === 'horazon') ? (
          <MapOverview runs={myRuns} compare={compareRuns} focus={focus} characters={characters.map((name) => stats.characters.find((c) => c.name === name) ?? { name, class: null, level: null })} />
        ) : !captured ? (
          <CaptureHowTo />
        ) : (
          <p className="py-10 text-center text-sm text-muted">No maps run in this period.</p>
        ))}

      {subtab === 'bossing' && (!captured ? <CaptureHowTo /> : <BossOverview runs={myRuns} focus={focus} characters={characters.map((name) => stats.characters.find((c) => c.name === name) ?? { name, class: null, level: null })} />)}

      {subtab === 'zones' &&
        (myRuns.some((r) => r.kind === 'zone') ? (
          <ZoneOverview runs={myRuns} focus={focus} characters={characters.map((name) => stats.characters.find((c) => c.name === name) ?? { name, class: null, level: null })} />
        ) : (
          <p className="py-10 text-center text-sm text-muted">No zones outside maps in this period.</p>
        ))}

      {subtab === 'currency' && (
        <>
          {/* Owned is a snapshot of now: not for a past season. */}
          {range.until === null && <RuneStash track={trackRune} onTrack={setTrackRune} />}
          {/* The tracked rune right under the runes it picks from (a rune's name there sets it too). */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className={`${input} flex items-center gap-2`}>
            <span className="text-muted">Track</span>
            <select className="bg-transparent outline-none" value={trackRune} onChange={(e) => setTrackRune(Number(e.target.value))}>
              {RUNE_NAMES.map((name, i) => (
                <option key={name} value={i + 1} className="bg-panel">
                  {i === 0 ? 'All runes' : `${name}+`}
                </option>
              ))}
            </select>
          </label>
          {trackedCount === 0 ? (
            // Nothing tracked yet: one sentence, not a row of dashes.
            <p className="text-sm text-muted">
              No {trackName}+ runes in this period yet
              {droughtKills !== null && last ? ` · ${fmtCompact(droughtKills)} kills since the last ${currencyLabel(last.drop.item)}` : ''}. Pick a
              lower rune to follow those instead.
            </p>
          ) : (
          <Ledger
            items={[
              { value: fmtNumber(trackedCount), label: `${markerLabel}s`, title: 'In this period' },
              { value: killsGained !== null && trackedCount ? fmtCompact(killsGained / trackedCount) : '–', label: `kills per ${trackName}+` },
              { value: mapsGained !== null && trackedCount ? (mapsGained / trackedCount).toFixed(1) : '–', label: `maps per ${trackName}+` },
            ]}
          />
          )}
          </div>
          <GapTable gaps={gapsInRange} droughtKills={droughtKills} droughtMaps={droughtMaps} trackName={trackName} />
          <CurrencyTable drops={currencyFound} />
        </>
      )}
    </>
  );
}

const recordDateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * A counter in the Activity line: with a season picked, its gain in the season (as the charts
 * below show it), the lifetime total muted beside it; all time, just the total.
 */
const seasonFirst = (n: number | null, total: Point[], from: number | null, fmt: (n: number) => string, lifeFmt = fmtCompact) => {
  if (!total.length) return { value: '–' };
  const life = total.at(-1)!.v;
  if (from === null) return { value: fmt(life) };
  // No reading inside the season: the gain is unknown, not zero.
  if (n === null || !total.some((p) => p.t >= from))
    return { value: <span className="font-sans text-sm font-medium text-faint">not read this season</span>, note: `${lifeFmt(life)} lifetime` };
  return { value: fmt(n), note: life !== n ? `${lifeFmt(life)} lifetime` : undefined };
};

function GapTable({
  gaps,
  droughtKills,
  droughtMaps,
  trackName,
}: {
  gaps: Gap[];
  droughtKills: number | null;
  droughtMaps: number | null;
  trackName: string;
}) {
  const known = gaps.filter((g) => g.kills !== null);
  const avgKills = known.length ? known.reduce((n, g) => n + g.kills!, 0) / known.length : null;
  const cell = 'px-3 py-2 text-right tabular-nums';
  const dash = <span className="text-muted">—</span>;
  // No runes yet: the line at the top of Currency already says so.
  if (gaps.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg text-text">Between {trackName}+ runes</h2>
        {avgKills !== null && (
          <span className="text-xs text-muted">
            Average gap: <span className="text-text tabular-nums">{fmtNumber(avgKills)}</span> kills
          </span>
        )}
      </header>
      <div className="rounded-sm border border-line bg-panel">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 text-left font-normal">Rune</th>
                <th className="px-3 py-2 text-left font-normal">Found</th>
                <th className={`${cell} font-normal`}>Kills since previous</th>
                <th className={`${cell} font-normal`}>Maps since previous</th>
              </tr>
            </thead>
            <tbody>
              {(droughtKills !== null || droughtMaps !== null) && (
                <tr className="border-b border-line/60 text-muted">
                  <td className="px-3 py-2" colSpan={2}>
                    Now (still looking)
                  </td>
                  <td className={cell}>{droughtKills !== null ? fmtNumber(droughtKills) : dash}</td>
                  <td className={cell}>{droughtMaps !== null ? fmtNumber(droughtMaps) : dash}</td>
                </tr>
              )}
              {[...gaps].reverse().map((g) => (
                <tr key={g.drop.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <ItemIcon item={g.drop.item} box={24} />
                      <span className="text-q-crafted">{currencyLabel(g.drop.item)}</span>
                      {g.drop.quantity > 1 && <span className="text-muted">×{g.drop.quantity}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted">{fullFmt.format(g.t)}</td>
                  <td className={cell}>{g.kills !== null ? fmtNumber(g.kills) : dash}</td>
                  <td className={cell}>{g.maps !== null ? fmtNumber(g.maps) : dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">
        Kill counts come from captured games and are interpolated within a game.
      </p>
      </div>
    </section>
  );
}


const chipDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const SESSIONS_PAGE = 8;
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const nextMidnight = (t: number) => new Date(t).setDate(new Date(t).getDate() + 1);

/**
 * The sessions of the characters shown, newest first, as rows that open their recap above: those
 * that touched the picked calendar day, or a page at a time. Each says what it was (maps, zones,
 * boss fights), what it gave (kills, the best find) and who played.
 */
function SessionList({
  games,
  runs,
  drops,
  from,
  day,
  onClearDay,
}: {
  games: CaptureGame[];
  runs: MapRun[];
  drops: Drop[];
  from: number | null;
  day: number | null;
  onClearDay: () => void;
}) {
  const values = useValues();
  const [page, setPage] = useState(0);
  const all = useMemo(() => allSessions(games, false).filter((x) => from === null || x.end.getTime() >= from), [games, from]);
  const list = day === null ? all : all.filter((x) => x.start.getTime() < nextMidnight(day) && x.end.getTime() >= day);
  const pages = Math.ceil(list.length / SESSIONS_PAGE);
  const at = Math.min(page, Math.max(0, pages - 1));
  const shown = day === null ? list.slice(at * SESSIONS_PAGE, (at + 1) * SESSIONS_PAGE) : list;
  if (!all.length) return null;

  // A time on the row's own day (the picked one, or the day it started) goes bare; an end on
  // another day (past midnight, or one of those three-day sessions) carries its date.
  const clock = (d: Date, ref: number) => (d.getTime() >= ref && d.getTime() < nextMidnight(ref) ? formatTime(d) : `${chipDayFmt.format(d)}, ${formatTime(d)}`);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <section className="flex flex-col gap-2" aria-label="Sessions">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg text-text">{day === null ? 'Sessions' : `Sessions · ${dayLabel(new Date(day))}`}</h2>
        <span className="flex items-center gap-3 text-xs text-muted">
          {day !== null ? (
            <button className="text-accent hover:underline" onClick={onClearDay}>
              All sessions
            </button>
          ) : (
            pages > 1 && <Pager page={at} pages={pages} onPage={setPage} />
          )}
        </span>
      </header>
      {shown.length === 0 ? (
        <p className="rounded-sm border border-line bg-panel px-4 py-3 text-sm text-muted">No sessions that day: only quick games with no maps and no kills.</p>
      ) : (
        <ol className="rounded-sm border border-line bg-panel">
          {shown.map((x) => {
            const t0 = x.start.getTime();
            const t1 = x.end.getTime();
            const inside = (iso: string) => {
              const t = Date.parse(iso);
              return t >= t0 && t <= t1;
            };
            const theirRuns = runs.filter((r) => inside(r.started_at));
            const maps = theirRuns.filter((r) => r.kind === 'map');
            const zones = theirRuns.filter((r) => r.kind === 'zone').length;
            const fights = buildFights(theirRuns);
            const bossKills = fights.filter((f) => f.killSeconds !== null).length;
            const theirGames = games.filter((g) => inside(g.started_at));
            const kills = theirGames.reduce((n, g) => n + (g.deaths || g.kills), 0);
            const who = [...new Set(theirGames.map((g) => g.character).filter((c): c is string => !!c))];
            const best = drops
              .filter((d) => !d.ignored && inside(d.found_at) && isNotable(d, PUL, tierOf(d.item, values)))
              .sort((a, b) => rankScore(b, new Set(), tierOf(b.item, values)) - rankScore(a, new Set(), tierOf(a.item, values)))[0];
            const tierMix = new Map<string, number>();
            for (const r of maps) {
              const tier = mapInfo(r.map_code).tier ?? 'Unique';
              tierMix.set(tier, (tierMix.get(tier) ?? 0) + 1);
            }
            const ref = day ?? midnight(x.start);
            return (
              <li key={t0} className="border-b border-line/60 last:border-0">
                <a
                  href={`#session/${t0}`}
                  className="grid grid-cols-[7.5rem_minmax(11rem,auto)_4.5rem_minmax(0,1.2fr)_5rem_minmax(0,1fr)] items-baseline gap-x-4 px-4 py-2 text-sm hover:bg-panel-hi focus-visible:bg-panel-hi focus-visible:outline-none"
                >
                  <span className="truncate text-muted">{dayLabel(x.start)}</span>
                  <span className="font-num font-semibold whitespace-nowrap text-text tabular-nums">
                    {clock(x.start, ref)}–{clock(x.end, ref)}
                  </span>
                  <span className="font-num text-right text-muted tabular-nums">{fmtDuration((t1 - t0) / 1000)}</span>
                  <span className="truncate text-muted">
                    {[
                      maps.length > 0 && (
                        <span key="m" className="text-text" title={[...tierMix].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ')}>
                          {plural(maps.length, 'map', 'maps')}
                        </span>
                      ),
                      zones > 0 && <span key="z">{plural(zones, 'zone', 'zones')}</span>,
                      fights.length > 0 && (
                        <span key="b" className={bossKills ? 'text-q-set' : ''} title={`${bossKills} of ${fights.length} killed`}>
                          {plural(fights.length, 'boss', 'bosses')}
                        </span>
                      ),
                    ]
                      .filter(Boolean)
                      .flatMap((el, i) => (i ? [<span key={`s${i}`}> · </span>, el] : [el]))}
                  </span>
                  <span className="font-num text-right text-text tabular-nums" title="Kills">
                    {fmtCompact(kills)}
                    <span className="ml-1 font-sans text-xs text-muted">kills</span>
                  </span>
                  <span className="flex min-w-0 items-baseline justify-end gap-2">
                    {best && <span className={`truncate ${nameColor(best.item)}`}>{best.item.name}</span>}
                    <span className="shrink-0 truncate text-xs text-muted">{who.join(', ')}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Best days for notable drops and high runes, and each high rune's first drop, in the period picked. */
function PlayRecords({ drops }: { drops: Drop[] }) {
  const values = useValues();
  const byDay = new Map<string, { drops: number; high: number }>();
  const firsts = new Map<number, Drop>();
  for (const d of [...drops].sort((a, b) => a.found_at.localeCompare(b.found_at))) {
    const k = new Date(d.found_at).toLocaleDateString('sv'); // YYYY-MM-DD, local
    const e = byDay.get(k) ?? { drops: 0, high: 0 };
    const n = runeNumber(d.item) ?? 0;
    // "Drops" here are notable drops, as everywhere else they're counted.
    if (isNotable(d, PUL, tierOf(d.item, values))) e.drops += d.quantity;
    if (n >= TIER_RANGE.High[0]) {
      e.high += d.quantity;
      if (!firsts.has(n)) firsts.set(n, d);
    }
    byDay.set(k, e);
  }
  const best = (k: 'drops' | 'high') => {
    const t = [...byDay].filter(([, v]) => v[k] > 0).sort(([, a], [, b]) => b[k] - a[k])[0];
    return { value: t ? fmtNumber(t[1][k]) : null, hint: t ? recordDateFmt.format(new Date(`${t[0]}T12:00`)) : 'Nothing yet' };
  };
  const firstList = [...firsts].sort(([a], [b]) => b - a);
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg text-text">Best drop days</h2>
        <Figures
          items={[
            { label: 'Most notable drops in a day', ...best('drops') },
            { label: 'Most high runes in a day', ...best('high') },
          ]}
        />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg text-text">First high runes</h2>
        <div className="rounded-sm border border-line bg-panel">
          {firstList.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Each high rune's first drop in this period shows here.</p>
          ) : (
            <ol>
              {firstList.map(([n, d]) => (
                <li key={n} className="flex items-baseline justify-between gap-4 border-b border-line/60 px-4 py-2 text-sm last:border-0">
                  <span className="text-text">{RUNE_NAMES[n - 1]}</span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {recordDateFmt.format(new Date(d.found_at))}
                    {d.character && ` · ${d.character}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

function HowTo() {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-panel px-5 py-4 text-sm">
      <h2 className="text-text">No stats yet</h2>
      <p className="text-muted">Kills, maps, deaths and playtime come from captured games. Start capture and play a game.</p>
    </div>
  );
}
