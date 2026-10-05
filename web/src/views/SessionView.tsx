import { useEffect, useMemo, useState } from 'react';
import { ItemIcon } from '../components/ItemIcon';
import { Ledger } from '../components/Ledger';
import { Pager } from '../components/Pager';
import { FloatingTooltip } from '../components/ItemTooltip';
import { NewMark } from '../components/NewTag';
import { EventIcon, MapCrafts } from '../components/EventIcon';
import type { KillRate } from '../components/KillRateChart';
import { runMapLabel } from '../components/MapSections';
import { FacetRoll, TorchRoll } from '../components/DropList';
import { buildFights, fightAsLive, progressOf, type Fight } from '../components/BossOverview';
import { fetchDrops, fetchGrail } from '../lib/api';
import { areaName, bossSkipped, fetchCaptureGames, fetchRuns, isClear, runKills, type CaptureGame, type MapRun } from '../lib/capture';
import { itemKind, nameColor } from '../lib/itemStyle';
import { useChanges } from '../lib/live';
import { PUL, runeNumber } from '../lib/runes';
import type { SystemStatus } from '../lib/status';
import { tierOf, tierStyle } from '../lib/tiers';
import { dayLabel, fmtClock, formatTime } from '../lib/time';
import type { Drop, Item } from '../lib/types';
import { useValues } from '../lib/values';
import { sessionXp, type SessionXp } from '../lib/xp';
import { isNotable, rankScore } from '../lib/rank';
import { BossPilot, MapLine, formatDelta, useClock, useKillCounter, type KillCounterData } from './KillCounterView';

/** Games closer together than this belong to one session. */
const SESSION_GAP_MS = 45 * 60e3;

/**
 * Every run of games with no long break, newest first: when each started and ended. Games with no
 * map and nothing killed (a quick join and leave) don't count, unless it's the game being played now.
 */
export function allSessions(games: CaptureGame[], inGame: boolean): { start: Date; end: Date }[] {
  const sorted = [...games]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .filter((g, i) => g.maps > 0 || (g.fights ?? 0) > 0 || g.deaths > 0 || (inGame && i === 0));
  const out: { start: Date; end: Date }[] = [];
  for (const g of sorted) {
    const cur = out.at(-1);
    if (cur && cur.start.getTime() - new Date(g.ended_at).getTime() <= SESSION_GAP_MS) cur.start = new Date(g.started_at);
    else out.push({ start: new Date(g.started_at), end: new Date(g.ended_at) });
  }
  return out;
}

/** The latest session; null before the first game. */
export function lastSession(games: CaptureGame[], inGame: boolean): { start: Date; end: Date } | null {
  return allSessions(games, inGame)[0] ?? null;
}

/** `#session/<ms>`: the session holding that moment, picked from the history; null on plain `#session`. */
const pickedFromHash = () => {
  const ms = Number(location.hash.match(/^#session\/(\d+)$/)?.[1]);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

/**
 * Runs that beat every earlier clear of their map (by area, as the kill counter compares them),
 * with how much faster. A map's first clear sets the mark without beating one.
 */
export function fastestClears(runs: MapRun[], earlier: MapRun[]): Map<number, number> {
  const best = new Map<number, number>();
  for (const r of earlier.filter(isClear)) best.set(r.area, Math.min(r.seconds, best.get(r.area) ?? Infinity));
  const out = new Map<number, number>();
  for (const r of [...runs].filter(isClear).sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const before = best.get(r.area);
    if (before !== undefined && r.seconds < before) out.set(r.id, r.seconds - before);
    best.set(r.area, Math.min(r.seconds, before ?? Infinity));
  }
  return out;
}


const AHEAD = 'text-q-set';
const BEHIND = 'text-q-red';

function Stat({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span className={`font-num text-xl leading-tight font-semibold tabular-nums ${className}`}>{children}</span>
    </div>
  );
}

/** "+8.2%" of a level under one, "+1.4 levels" past it. */
const fmtLevels = (n: number) => (Math.abs(n) < 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)} levels`);
const fmtHours = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${Math.round(h / 24)} days`);

/**
 * How far into the level, what the session added (bright) on top of where it began (dim), and
 * what deaths took (red, after the fill: where the bar would be without them).
 */
function XpStrip({ xp, ongoing }: { xp: SessionXp; ongoing: boolean }) {
  const lvl = Math.floor(xp.now);
  const pct = xp.now - lvl;
  const startPct = xp.from >= lvl ? xp.from - lvl : 0;
  const lostPct = Math.min(xp.lost, 1 - pct);
  const gained = xp.now - xp.from;
  return (
    <div className="mt-2 flex flex-col gap-1.5" aria-label="Experience">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-muted">
        <span className="font-num text-lg font-semibold text-text tabular-nums">
          Lv {lvl}
          <span className="ml-2 text-base text-muted">{(pct * 100).toFixed(1)}%</span>
        </span>
        <span className={`font-num text-base font-semibold tabular-nums ${gained < 0 ? BEHIND : 'text-text'}`}>
          {gained >= 0 ? '+' : '−'}
          {fmtLevels(Math.abs(gained))}
          <span className="ml-1.5 font-sans text-sm font-medium text-muted">this session</span>
        </span>
        {xp.lost > 0 && (
          <span className={`font-num text-base font-semibold tabular-nums ${BEHIND}`} title="Net of what picking up the corpse gave back">
            −{fmtLevels(xp.lost)}
            <span className="ml-1.5 font-sans text-sm font-medium text-muted">
              to {xp.died ? `${xp.died} ${xp.died === 1 ? 'death' : 'deaths'}` : 'deaths'}
            </span>
          </span>
        )}
        {ongoing && xp.hoursToNext !== null && (
          <span title={`At this session's pace, ${Math.round(xp.perHour! / 1e6).toLocaleString()}M experience an hour`}>
            Lv {lvl + 1} in <span className="font-num text-base font-semibold text-text tabular-nums">~{fmtHours(xp.hoursToNext)}</span>
          </span>
        )}
      </div>
      <div className="relative h-2 overflow-hidden rounded-[1px] bg-bg ring-1 ring-line" title={`${(pct * 100).toFixed(1)}% of the way to level ${lvl + 1}`}>
        <div className="absolute inset-y-0 left-0 bg-accent/35" style={{ width: `${Math.min(startPct, pct) * 100}%` }} />
        <div className="absolute inset-y-0 bg-accent" style={{ left: `${startPct * 100}%`, width: `${Math.max(0, pct - startPct) * 100}%` }} />
        {lostPct > 0 && <div className="absolute inset-y-0 bg-q-red/55" style={{ left: `${pct * 100}%`, width: `${lostPct * 100}%` }} />}
      </div>
    </div>
  );
}

/** The map in progress, at glance size: clock and kills, the forces bar, pace against the best clear. */
function LiveRun({ data }: { data: Extract<KillCounterData, { state: 'running' | 'paused' }> }) {
  const clock = useClock(data);
  const pct = data.total ? Math.min(1, data.deaths / data.total) : null;
  const best = data.best?.seconds ?? null;
  const paused = data.state === 'paused';
  const source =
    data.totalSource === 'game'
      ? 'exact count'
      : data.totalSource === 'map'
        ? `estimated from ${data.historyRuns} run${data.historyRuns === 1 ? '' : 's'}`
        : data.totalSource === 'tier'
          ? `estimated from tier ${data.run.tier} maps`
          : 'no estimate yet';
  return (
    <section className="rounded-sm border border-line bg-panel px-5 py-4 md:px-6 md:py-5" aria-label="Current map">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-[28px] leading-tight font-bold text-text">
            {data.run.name}
            <span className="ml-3 font-sans text-base font-semibold text-muted">
              {data.run.tier && `Tier ${data.run.tier}`}
              {data.run.quality && <span className="capitalize">{data.run.tier ? ' · ' : ''}{data.run.quality}</span>}
            </span>
          </h1>
          <div className="text-text">
            <MapLine stats={data.run.stats} />
          </div>
        </div>
        <div className={`flex items-baseline gap-8 font-num leading-none font-bold tabular-nums ${paused ? 'text-muted' : ''}`}>
          <span className="text-[56px]">
            {data.deaths.toLocaleString()}
            <span className="ml-1.5 text-lg font-semibold text-muted">kills</span>
          </span>
          <span className="text-[56px]">
            {paused && <span className="mr-2 align-middle font-sans text-base font-semibold text-warn">Paused</span>}
            {fmtClock(clock)}
          </span>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-1.5">
        <div className="relative h-3 overflow-hidden rounded-[1px] bg-bg ring-1 ring-line" title="Share of the map's monsters killed">
          {pct !== null && (
            <div className={`h-full bg-accent ${paused ? 'opacity-60' : 'shadow-[0_0_12px_var(--color-accent)]'}`} style={{ width: `${pct * 100}%` }} />
          )}
          {data.splits.slice(0, -1).map((s) => (
            <div key={s.share} className="absolute inset-y-0 w-px bg-bg" style={{ left: `${s.share * 100}%` }} />
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted">
          <span>{data.total !== null ? `${data.total.toLocaleString()} monsters, ${source}` : source}</span>
          {pct !== null && <span className="font-num text-base font-semibold text-text">{(pct * 100).toFixed(1)}%</span>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line/70 pt-4 sm:grid-cols-4 lg:grid-cols-[repeat(4,auto)_1fr]">
        <Stat label="Against best" className={data.delta === null ? 'text-muted' : data.delta <= 0 ? AHEAD : BEHIND}>
          {data.delta === null ? '–' : formatDelta(data.delta)}
        </Stat>
        <Stat label="Best clear">{best !== null ? fmtClock(best) : '–'}</Stat>
        <Stat label="Median clear">{data.medianClear !== null ? fmtClock(data.medianClear) : '–'}</Stat>
        <Stat
          label="Kills / min"
          className={data.rate.avg !== null && data.rate.best !== null ? (data.rate.avg >= data.rate.best ? AHEAD : BEHIND) : ''}
        >
          {data.rate.avg !== null ? Math.round(data.rate.avg) : '–'}
          {data.rate.best !== null && <span className="ml-1.5 text-sm text-muted">best {Math.round(data.rate.best)}</span>}
        </Stat>
        <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-1 sm:col-span-4 lg:col-span-1 lg:justify-end">
          {data.splits.map((s) => {
            const diff = s.at !== null && s.best !== null ? s.at - s.best : null;
            return (
              <span key={s.share} className="font-num text-sm font-semibold tabular-nums">
                <span className="text-muted">{s.share === 1 ? 'Clear' : `${s.share * 100}%`} </span>
                {s.at !== null ? (
                  <span className={diff === null ? '' : diff <= 0 ? AHEAD : BEHIND}>{diff !== null ? formatDelta(diff) : fmtClock(s.at)}</span>
                ) : (
                  <span className="text-faint">{s.best !== null ? fmtClock(s.best) : '–'}</span>
                )}
              </span>
            );
          })}
          {data.boss && (
            <span className={`font-num text-sm font-semibold ${data.boss.at === null ? 'text-muted' : AHEAD}`}>
              {data.boss.name}
              {data.boss.at !== null && ` ${fmtClock(data.boss.at)}`}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

/** In a game, no map open: what happens next, and how the last map went. */
function BetweenMaps({ last }: { last: MapRun | undefined }) {
  const label = last ? runMapLabel(last) : null;
  return (
    <section className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-sm border border-line bg-panel px-5 py-5 md:px-6" aria-label="Current map">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-text">Between maps</h1>
        <p className="max-w-[62ch] text-sm text-muted">Open a map and its clock, kills and pace against your best clear appear here.</p>
      </div>
      {last && label && (
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className={`font-semibold ${label.color}`}>
            <span className="font-normal text-muted">Last map: </span>
            {label.tier && label.tier !== 'Unique' ? `${label.tier} ` : ''}
            {label.name}
          </span>
          <span className="font-num text-sm text-muted tabular-nums">
            {fmtClock(last.seconds)} · {runKills(last).n.toLocaleString()} kills
            {last.clear !== null && ` · ${Math.round(last.clear * 100)}%`}
          </span>
        </div>
      )}
    </section>
  );
}

/** A run's name: the map's, or the zone's for zone farming. */
const runLabel = (r: MapRun) => (r.kind === 'zone' ? { name: areaName(r.area), tier: 'Zone', color: 'text-text' } : runMapLabel(r));

/** Seconds into a run when it reached `n` monster deaths, read off its kill-rate bars (approximate). */
function timeAt(rate: KillRate | null, n: number): number | null {
  if (!rate) return null;
  let done = 0;
  for (let i = 0; i < rate.bars.length; i++) {
    const k = (rate.bars[i] * rate.step) / 60;
    if (done + k >= n) return (i + (k ? (n - done) / k : 0)) * rate.step;
    done += k;
  }
  return null;
}

const SPLITS = [0.25, 0.5, 0.75];
/** "−1:17" in green for the eye; "1:17 ahead of your best" for screen readers. */
function Delta({ d }: { d: number }) {
  return (
    <span className={d <= 0 ? AHEAD : BEHIND}>
      <span aria-hidden>{formatDelta(d)}</span>
      <span className="sr-only">{`${fmtClock(Math.abs(d))} ${d <= 0 ? 'ahead of' : 'behind'} your best`}</span>
    </span>
  );
}
const perMin = (r: MapRun) => (r.seconds > 0 ? (runKills(r).n / r.seconds) * 60 : null);

/**
 * Between sessions, the story of the last run first: how it went against your best clear of
 * that map before it (time, splits, kill rate), or for a zone, its kill rate against your usual.
 */
function LastRun({ run, prior }: { run: MapRun; prior: MapRun[] }) {
  const label = runLabel(run);
  const zone = run.kind === 'zone';
  const clears = prior.filter(isClear);
  const best = clears.length ? clears.reduce((a, b) => (b.seconds < a.seconds ? b : a)) : null;
  const typical = median(clears.map((r) => r.seconds));
  const delta = isClear(run) && best ? run.seconds - best.seconds : null;
  const rate = perMin(run);
  const rates = (zone ? prior : clears).map(perMin).filter((v): v is number => v !== null);
  const usualRate = median(rates);
  const topRate = rates.length ? Math.max(...rates) : null;
  const total = !zone && run.clear ? run.deaths / run.clear : null;
  const splits = total
    ? SPLITS.filter((s) => s <= (run.clear ?? 0)).map((share) => {
        const at = timeAt(run.rate, share * total);
        const was = best ? timeAt(best.rate, share * total) : null;
        return { share, at, diff: at !== null && was !== null ? at - was : null };
      })
    : [];
  const corrupted = zone && run.corrupted === true;
  return (
    <section className="rounded-sm border border-line bg-panel px-5 py-4 md:px-6 md:py-5" aria-label="Last run">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs text-muted">
            {/* The day too: between games yesterday's run must not read as tonight's. */}
            Last run · {dayLabel(new Date(run.started_at)) !== 'Today' && `${dayLabel(new Date(run.started_at))}, `}
            {formatTime(new Date(run.started_at))}
            {run.character && ` · ${run.character}`}
          </span>
          <h1 className={`flex items-center gap-2 text-[28px] leading-tight font-bold ${label.color}`}>
            {label.name}
            {zone ? corrupted && <EventIcon kind="corrupted" className="text-q-red" /> : <MapCrafts stats={run.map_stats} />}
            <span className="ml-1 font-sans text-base font-semibold text-muted">
              {label.tier === 'Zone' ? 'Zone' : label.tier && label.tier !== 'Unique' ? `Tier ${label.tier.slice(1)}` : label.tier}
            </span>
          </h1>
          {!zone && (
            <div className="text-text">
              <MapLine stats={run.map_stats} />
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-baseline gap-8 font-num leading-none font-bold tabular-nums">
            <span className="text-[56px]">
              {runKills(run).n.toLocaleString()}
              <span className="ml-1.5 text-lg font-semibold text-muted">kills</span>
            </span>
            <span className="text-[56px]">{fmtClock(run.seconds)}</span>
          </div>
          {/* The splits sit under the clock they qualify. */}
          {(splits.length > 0 || run.clear !== null) && (
            <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 font-num text-base font-semibold tabular-nums">
              {splits.map((s) => (
                <span key={s.share} title="Against your best clear at the same share of the map, read off the kill curves">
                  <span className="text-muted">{s.share * 100}% </span>
                  {s.diff !== null ? (
                    <Delta d={s.diff} />
                  ) : (
                    <span>{s.at !== null ? fmtClock(s.at) : '–'}</span>
                  )}
                </span>
              ))}
              {run.clear !== null && (
                <span>
                  <span className="text-muted">Clear </span>
                  {Math.round(run.clear * 100)}%
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line/70 pt-4 sm:grid-cols-4 lg:grid-cols-[repeat(4,auto)_1fr]">
        {zone ? (
          <Stat label="Runs of this zone before">{prior.length || '–'}</Stat>
        ) : (
          <Stat label="Against best" className={delta === null ? 'text-muted' : delta <= 0 ? AHEAD : BEHIND}>
            {delta !== null ? <Delta d={delta} /> : run.clear !== null && !isClear(run) ? <span className="text-base">not a clear</span> : best ? '–' : <span className="text-base">first clear</span>}
          </Stat>
        )}
        {/* One or two earlier clears make best and median the same figure: say it once. */}
        {!zone && <Stat label={clears.length === 1 ? 'Previous clear' : 'Best clear before'}>{best ? fmtClock(best.seconds) : '–'}</Stat>}
        {!zone && clears.length >= 3 && <Stat label="Median clear">{typical !== null ? fmtClock(typical) : '–'}</Stat>}
        <Stat label="Kills / min" className={rate !== null && usualRate !== null ? (rate >= usualRate ? AHEAD : BEHIND) : ''}>
          {rate !== null ? Math.round(rate) : '–'}
          {usualRate !== null && <span className="ml-1.5 text-sm text-muted">usual {Math.round(usualRate)}</span>}
          {zone && topRate !== null && <span className="ml-1.5 text-sm text-muted">best {Math.round(topRate)}</span>}
        </Stat>
        <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-1 sm:col-span-4 lg:col-span-1 lg:justify-end">
          {run.boss && (
            <span className={`font-num text-sm font-semibold ${run.boss_seconds === null ? 'text-muted' : AHEAD}`}>
              <span className="mr-1.5 font-sans font-medium text-muted">Boss</span>
              {run.boss}
              {run.boss_seconds !== null ? ` ${fmtClock(run.boss_seconds)}` : bossSkipped(run) ? ' skipped' : ''}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

/** The session's best drop, as a haul card: what to look at first between games. */
function BestFind({ drop, newFind }: { drop: Drop; newFind: boolean }) {
  const values = useValues();
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const tier = tierOf(drop.item, values);
  const rune = runeNumber(drop.item);
  return (
    <section className="flex flex-col" aria-label="Best find">
      <h2 className="mb-2 text-base text-text">Best find</h2>
      <div
        style={tierStyle(tier)}
        className={`flex min-h-[208px] flex-col justify-between gap-2 rounded-sm border border-line bg-panel px-4 pt-3 pb-4 ${tier ? 'tier-card' : ''}`}
        onMouseMove={(e) => setHover({ item: drop.item, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)}
      >
        <div className="flex min-h-5 justify-end">{newFind && <NewMark size={18} />}</div>
        <div className={`flex h-[96px] items-center justify-center ${tier ? 'tier-glow' : ''}`}>
          <ItemIcon item={drop.item} box={96} grow />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={`font-display text-lg leading-tight font-extrabold uppercase ${nameColor(drop.item)}`}>
            {drop.item.name}
            {drop.quantity > 1 && <span className="text-text"> ×{drop.quantity}</span>}
          </span>
          <span className="text-xs text-muted">
            {rune !== null ? `Rune #${rune} · ` : itemKind(drop.item) !== drop.item.name ? `${itemKind(drop.item)} · ` : ''}
            <span className="whitespace-nowrap">{formatTime(new Date(drop.found_at))}</span>
            {tier && ` · ${tier.name}`}
            <FacetRoll item={drop.item} />
            <TorchRoll item={drop.item} />
          </span>
        </div>
      </div>
      {hover && <FloatingTooltip {...hover} />}
    </section>
  );
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Each map of the session against your clears of it before the session: best, typical, and the session's best. */
function AgainstBest({ runs, earlier }: { runs: MapRun[]; earlier: MapRun[] }) {
  const areas = [...new Set(runs.filter((r) => r.kind !== 'zone').map((r) => r.area))];
  if (!areas.length) return null;
  const rows = areas.map((area) => {
    const mine = runs.filter((r) => r.area === area);
    const now = mine.filter(isClear).map((r) => r.seconds);
    const before = earlier.filter((r) => r.area === area && isClear(r)).map((r) => r.seconds);
    return {
      area,
      label: runMapLabel(mine[0]),
      count: mine.length,
      best: now.length ? Math.min(...now) : null,
      prior: before.length ? Math.min(...before) : null,
      typical: median(before),
    };
  });
  const cell = 'px-3 py-1.5 text-right font-num text-[15px]';
  return (
    <section className="flex min-w-0 flex-col">
      <h2 className="mb-2 flex items-baseline justify-between gap-3 text-base text-text">
        Against your best
        <span className="font-sans text-xs font-normal text-muted max-sm:hidden">Clears of 90% or more, against your clears before this session</span>
      </h2>
      <div className="overflow-x-auto rounded-sm border border-line bg-panel">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line text-left">
              <th className="px-3 py-1.5 font-normal">Map</th>
              <th className="px-3 py-1.5 text-right font-normal max-sm:hidden">Runs</th>
              <th className="px-3 py-1.5 text-right font-normal">Best now</th>
              <th className="px-3 py-1.5 text-right font-normal">Best before</th>
              <th className="px-3 py-1.5 text-right font-normal max-sm:hidden">Typical</th>
              <th className="px-3 py-1.5 text-right font-normal">Against best</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = r.best !== null && r.prior !== null ? r.best - r.prior : null;
              return (
                <tr key={r.area} className="border-b border-line/50 last:border-0">
                  <td className="px-3 py-1.5">
                    {r.label.tier && r.label.tier !== 'Unique' && <span className="mr-1.5 text-muted">{r.label.tier}</span>}
                    <span className={r.label.color}>{r.label.name}</span>
                  </td>
                  <td className={`${cell} max-sm:hidden`}>{r.count}</td>
                  <td className={cell}>{r.best !== null ? fmtClock(r.best) : <span className="text-faint">no clear</span>}</td>
                  <td className={`${cell} text-muted`}>{r.prior !== null ? fmtClock(r.prior) : '–'}</td>
                  <td className={`${cell} text-muted max-sm:hidden`}>{r.typical !== null ? fmtClock(r.typical) : '–'}</td>
                  <td className={`${cell} font-semibold ${delta === null ? 'text-faint' : delta < 0 ? AHEAD : BEHIND}`}>
                    {delta !== null ? formatDelta(delta) : r.best !== null ? 'first clear' : '–'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** First-time grail finds under the Best find card: a short list, names in their quality colour. */
function GrailFinds({ drops }: { drops: Drop[] }) {
  if (!drops.length) return null;
  return (
    <section className="flex flex-col">
      <h2 className="mb-2 flex items-center gap-1.5 text-base text-text">
        <NewMark size={15} />
        New for the grail
      </h2>
      <ul className="flex flex-col rounded-sm border border-line bg-panel">
        {drops.map((d) => (
          <li key={d.id} className="flex items-baseline justify-between gap-3 border-b border-line/50 px-3 py-1.5 text-sm last:border-0">
            <span className={`truncate font-semibold ${nameColor(d.item)}`}>{d.item.name}</span>
            <span className="shrink-0 text-xs text-muted tabular-nums">{formatTime(new Date(d.found_at))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SessionDrops({ drops, others, newFinds, title, besides }: { drops: Drop[]; others: number; newFinds: Set<number>; title: string; besides?: boolean }) {
  const values = useValues();
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const show = (item: Item, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setHover({ item, x: r.right - 24, y: r.top + r.height / 2 });
  };
  return (
    <section className="flex min-w-0 flex-col" onMouseLeave={() => setHover(null)}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-base text-text">{title}</h2>
        <a href="#drops" className="text-xs text-accent hover:underline">
          All drops
        </a>
      </div>
      {drops.length === 0 ? (
        // Beside a Best find the session did have a notable drop: say only that there is no other.
        <p className="border-t border-line py-3 text-sm text-muted">
          {besides
            ? 'No other notable drops.'
            : 'Nothing notable yet. Items in your tier list, Pul and higher runes, valuable currency and crafts you keep show up here.'}
        </p>
      ) : (
        <ul className="flex flex-col rounded-sm border border-line bg-panel">
          {drops.map((d) => {
            const tier = tierOf(d.item, values);
            const rune = runeNumber(d.item);
            return (
              <li
                key={d.id}
                tabIndex={0}
                style={tierStyle(tier)}
                className={`flex items-center gap-3 border-b border-line/50 px-3 py-1.5 last:border-0 hover:bg-panel-hi focus-visible:bg-panel-hi ${tier ? 'tier-row' : ''}`}
                onMouseMove={(e) => setHover({ item: d.item, x: e.clientX, y: e.clientY })}
                onFocus={(e) => show(d.item, e.currentTarget)}
                onBlur={() => setHover(null)}
              >
                <ItemIcon item={d.item} box={36} />
                <div className="min-w-0 flex-1">
                  <div className={`truncate font-semibold ${nameColor(d.item)}`}>
                    {d.item.name}
                    {d.quantity > 1 && <span className="ml-1.5 text-sm font-normal text-text">×{d.quantity}</span>}
                    {newFinds.has(d.id) && <NewMark size={15} className="ml-2 align-[-1px]" />}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {rune !== null ? `Rune #${rune}` : itemKind(d.item)}
                    <FacetRoll item={d.item} />
                    <TorchRoll item={d.item} />
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted tabular-nums">
                  {formatTime(new Date(d.found_at))}
                  {d.character && <div className="truncate">{d.character}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {others > 0 && <p className="mt-1.5 text-xs text-muted">and {others} other drop{others === 1 ? '' : 's'} (lower runes, rares, magic, bases)</p>}
      {hover && <FloatingTooltip {...hover} />}
    </section>
  );
}

/** A boss fight's Clear cell: killed, else how far it got (the lowest HP, bosses down, or Rathma's phase). */
function fightResult(f: Fight): { text: string; title: string; className: string } {
  if (f.killSeconds !== null) return { text: 'killed', title: `${f.boss} killed`, className: AHEAD };
  if (f.open) return { text: '–', title: 'In progress', className: 'text-muted' };
  const p = progressOf(f);
  const text = p.count !== null ? (p.count.startsWith('Swamp') || p.count.startsWith('Jungle') ? `ph ${f.phase}/3` : p.count.split(' ')[0]) : p.hp !== null ? `${p.hp}%` : '–';
  const how = p.count !== null ? (p.name ? `${p.count}, ${p.name} at ${p.hp}%` : p.count) : p.hp !== null ? `${f.boss} down to ${p.hp}%` : 'no hits seen';
  return { text, title: `Failed: ${how}`, className: 'text-q-red' };
}

/**
 * The session's maps, zones and boss fights, newest first. A boss fight reads like a run: its
 * encounter and tier, the kill time (or time fighting), the kills in its arena, and "killed" or how
 * far it got where a map shows its clear.
 */
const RUNS_PAGE = 25;
/** A run's name in the session's table: a link to the run on the Runs page. */
const RUN_LINK = 'decoration-current/40 underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none';

function SessionRuns({ runs, fights, fastest, title }: { runs: MapRun[]; fights: Fight[]; fastest: Map<number, number>; title: string }) {
  const rows = [
    ...runs.map((r) => ({ at: Date.parse(r.started_at), run: r, fight: null })),
    ...fights.map((f) => ({ at: f.start, run: null, fight: f })),
  ].sort((a, b) => b.at - a.at);
  // A marathon session runs to hundreds of rows: a page at a time, newest first.
  const pages = Math.ceil(rows.length / RUNS_PAGE);
  const [page, setPage] = useState(0);
  const at = Math.min(page, Math.max(0, pages - 1));
  return (
    <section className="flex min-w-0 flex-col">
      <h2 className="mb-2 flex items-baseline justify-between gap-3 text-base text-text">
        {title}
        <span className="flex items-center gap-3">
          {pages > 1 && (
            <span className="font-sans text-xs font-normal text-muted">
              <Pager page={at} pages={pages} onPage={setPage} />
            </span>
          )}
          {fights.length > 0 && (
            <a href="#runs/bossing" className="font-sans text-xs font-normal text-accent hover:underline">
              Bossing
            </a>
          )}
          <a href="#runs/maps" className="font-sans text-xs font-normal text-accent hover:underline">
            All runs
          </a>
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="border-t border-line py-3 text-sm text-muted">No maps, zones or boss fights this session.</p>
      ) : (
        <table className="w-full table-fixed rounded-sm border border-line bg-panel text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line text-left">
              <th className="px-3 py-1.5 font-normal">Map, zone or boss</th>
              <th className="w-16 px-2 py-1.5 text-right font-normal">Time</th>
              <th className="w-16 px-2 py-1.5 text-right font-normal">Kills</th>
              <th className="w-16 px-3 py-1.5 text-right font-normal">Clear</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(at * RUNS_PAGE, (at + 1) * RUNS_PAGE).map(({ run: r, fight: f }) => {
              if (f) {
                const result = fightResult(f);
                const kills = f.runs.reduce((n, x) => n + runKills(x).n, 0);
                return (
                  <tr key={f.key} className="border-b border-line/50 last:border-0">
                    <td className="truncate px-3 py-1.5">
                      <a href={`#runs/bossing/${f.runs[0].id}`} className={RUN_LINK} title="Open this fight on Runs → Bossing">
                        {f.tier !== null && ['Lucion', 'Rathma', 'Diablo Clone'].includes(f.boss) && <span className="text-muted">T{f.tier} </span>}
                        <span className="text-text">{f.boss}</span>
                      </a>
                      {f.deaths > 0 && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 align-[-2px] text-xs text-q-red" title={`Died ${f.deaths === 1 ? 'once' : `${f.deaths} times`}`}>
                          <EventIcon kind="death" size={14} title="Deaths" />
                          {f.deaths > 1 && f.deaths}
                        </span>
                      )}
                      {f.open && <span className="ml-2 text-xs text-accent">now</span>}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right font-num text-[15px] ${f.killSeconds !== null ? AHEAD : ''}`}
                      title={f.killSeconds !== null ? 'Kill time, from the summon' : 'Time inside the arena'}
                    >
                      {fmtClock(f.killSeconds ?? f.seconds)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-num text-[15px]">{kills.toLocaleString()}</td>
                    <td className={`px-3 py-1.5 text-right font-num text-[15px] ${result.className}`} title={result.title}>
                      {result.text}
                    </td>
                  </tr>
                );
              }
              const label = runLabel(r!);
              return (
                <tr key={r!.id} className="border-b border-line/50 last:border-0">
                  <td className="truncate px-3 py-1.5">
                    <a
                      href={`#runs/${r!.kind === 'zone' ? 'zones' : 'maps'}/${r!.id}`}
                      className={`${label.color} ${RUN_LINK}`}
                      title={`Open this run on Runs → ${r!.kind === 'zone' ? 'Zones' : 'Maps'}`}
                    >
                      {label.tier && label.tier !== 'Unique' && <span className="text-muted">{label.tier} </span>}
                      {label.name}
                    </a>
                    {r!.kind === 'zone' ? (
                      r!.corrupted && <EventIcon kind="corrupted" className="ml-1.5 inline-block align-[-2px] text-q-red" />
                    ) : (
                      <MapCrafts stats={r!.map_stats} className="ml-1.5 align-[-2px]" />
                    )}
                    {r!.open && <span className="ml-2 text-xs text-accent">now</span>}
                    {fastest.has(r!.id) && (
                      <span className={`ml-2 font-num text-sm font-semibold ${AHEAD}`} title="Your fastest clear of this map so far, against the one before">
                        <span className="max-sm:hidden">fastest </span>
                        {formatDelta(fastest.get(r!.id)!)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-num text-[15px]">{fmtClock(r!.seconds)}</td>
                  <td className="px-2 py-1.5 text-right font-num text-[15px]">{runKills(r!).n.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right font-num text-[15px] text-muted">{r!.clear !== null ? `${Math.round(r!.clear * 100)}%` : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export function SessionView({ status }: { status: SystemStatus }) {
  // `?sample=1`: the kill counter's sample run, for screenshots of the live panel.
  const live = useKillCounter(new URLSearchParams(location.search).get('sample') === '1');
  const [games, setGames] = useState<CaptureGame[] | null>(null);
  const [drops, setDrops] = useState<Drop[] | null>(null);
  const [runs, setRuns] = useState<MapRun[]>([]);
  const [fastest, setFastest] = useState<Map<number, number>>(new Map());
  const [earlier, setEarlier] = useState<MapRun[]>([]);
  // Uber boss fights (one summon across rejoins), this session's and the ones before, for "best kill".
  const [fights, setFights] = useState<Fight[]>([]);
  const [earlierFights, setEarlierFights] = useState<Fight[]>([]);
  const [newFinds, setNewFinds] = useState<Set<number>>(new Set());
  const version = useChanges('drops', 'runs', 'live');

  useEffect(() => {
    // A failed request (the server still starting) is not "no games": keep waiting, the next change retries.
    fetchCaptureGames().then(setGames, () => {});
  }, [version]);
  // An earlier session picked from the history below (`#session/<start>`), else the latest.
  const [picked, setPicked] = useState(pickedFromHash);
  useEffect(() => {
    const onHash = () => {
      setPicked(pickedFromHash());
      document.querySelector('main')?.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const sessions = useMemo(() => (games ? allSessions(games, status.live) : []), [games, status.live]);
  // The session holding the picked moment: a row filtered to one character can start after the session does.
  const session = (picked !== null && sessions.find((x) => x.start.getTime() <= picked && picked <= x.end.getTime())) || sessions[0] || null;
  // A past session is a record: nothing live shows on it.
  const past = !!session && session !== sessions[0];
  const playing = status.live && !past;
  const since = session?.start ?? null;
  const until = past ? session.end : null;
  const xp = useMemo(() => (games && session ? sessionXp(games, session.start, session.end) : null), [games, session]);

  useEffect(() => {
    if (!since) return;
    let cancelled = false;
    Promise.all([fetchDrops({ since, until }), fetchRuns({ since, until }), fetchRuns({ since: null, until: since })]).then(
      ([d, r, before]) => {
        if (cancelled) return;
        // Zones count too: early in a season the farming is mostly zones.
        // Maps and zones as runs; boss fights grouped by summon (a fight spans rejoins), listed with them.
        const sorted = r.runs.filter((x) => x.kind !== 'boss').sort((a, b) => b.started_at.localeCompare(a.started_at));
        setFights(buildFights(r.runs));
        setEarlierFights(buildFights(before.runs));
        setDrops(d.filter((x) => !x.ignored));
        setRuns(sorted);
        setFastest(fastestClears(sorted, before.runs));
        setEarlier(before.runs.filter((x) => x.kind !== 'boss'));
      },
      () => !cancelled && setDrops([]),
    );
    fetchGrail().then((g) => !cancelled && setNewFinds(new Set(g.flatMap((f) => (f.drop_id === null ? [] : [f.drop_id])))), () => {});
    return () => {
      cancelled = true;
    };
  }, [since?.getTime(), until?.getTime(), version]); // eslint-disable-line react-hooks/exhaustive-deps

  const values = useValues();
  // Notable as everywhere (rank.ts); first-time grail finds that aren't notable get their own list.
  const notable = (d: Drop) => isNotable(d, PUL, tierOf(d.item, values));
  const byTime = (a: Drop, b: Drop) => b.found_at.localeCompare(a.found_at);
  const shown = (drops ?? []).filter(notable).sort(byTime);
  const grailFinds = (drops ?? []).filter((d) => newFinds.has(d.id) && !notable(d)).sort(byTime);
  const others = (drops ?? []).filter((d) => !notable(d) && !newFinds.has(d.id)).reduce((n, d) => n + d.quantity, 0);
  // Kills in boss arenas count with the maps' and zones'.
  const kills = runs.reduce((n, r) => n + runKills(r).n, 0) + fights.reduce((n, f) => n + f.runs.reduce((m, r) => m + runKills(r).n, 0), 0);
  const runTime = runs.reduce((n, r) => n + r.seconds, 0);
  const mapCount = runs.filter((r) => r.kind !== 'zone').length;
  const zoneCount = runs.length - mapCount;
  const bossKills = fights.filter((f) => f.killSeconds !== null).length;
  // Between games the last finished run leads, against every earlier run of the same area; a boss
  // fight when it came last, against the earlier kills of that boss at its tier.
  const lastMap = !playing ? runs.find((r) => !r.open) : undefined;
  const lastFightDone = !playing ? fights.find((f) => !f.open) : undefined;
  const lastFight = lastFightDone && (!lastMap || lastFightDone.start > Date.parse(lastMap.started_at)) ? lastFightDone : undefined;
  const last = lastFight ? undefined : lastMap;
  const lastPrior = last ? [...runs, ...earlier].filter((r) => r.area === last.area && r.kind === last.kind && r.started_at < last.started_at) : [];
  // The session goes on while a game runs or until the break between games grows too long.
  const ongoing = playing || (!past && !!session && Date.now() - session.end.getTime() < SESSION_GAP_MS);
  const sameDay = session && session.start.toDateString() === session.end.toDateString();
  const Heading = ongoing || last ? 'h2' : 'h1';
  // Between games: the session's best drop and its maps against your best fill the page.
  // Best find is the best notable drop; first-time grail finds that aren't notable have their own list under it.
  const best = [...shown].sort(
    (a, b) => rankScore(b, newFinds, tierOf(b.item, values)) - rankScore(a, newFinds, tierOf(a.item, values)) || b.found_at.localeCompare(a.found_at),
  )[0];
  // The strip's "last game" can be a quick join with nothing in it: say why it isn't the session.
  const latestStart = games?.reduce<string | null>((m, g) => (m === null || g.started_at > m ? g.started_at : m), null) ?? null;
  const laterGame = session && latestStart && new Date(latestStart) > session.end ? new Date(latestStart) : null;
  const recap = !playing && drops !== null && (best || grailFinds.length > 0 || mapCount > 0 || fights.length > 0);
  const rest = best ? shown.filter((d) => d.id !== best.id) : shown;
  // A one-run session: the Last run panel already is that run (and its comparison), so no list repeats it.
  const oneRun = (!!last || !!lastFight) && runs.length + fights.length === 1;

  if (games !== null && !session && live.state === 'idle') {
    return (
      <section className="rounded-sm border border-line bg-panel px-5 py-5 md:px-6" aria-label="Current map">
        <h1 className="text-2xl font-bold text-text">No games yet</h1>
        <p className="mt-1 max-w-[62ch] text-sm text-muted">
          Start Project Diablo 2 and play: Horazon records games, map runs and drops on its own. There is nothing to do while you play.
        </p>
      </section>
    );
  }

  return (
    <>
      {/* A past session has no live panels: its last fight or run leads. */}
      {past ? (
        lastFight ? (
          <BossPilot data={{ state: 'boss', at: Date.now(), fight: fightAsLive(lastFight, [...fights, ...earlierFights]) }} wide />
        ) : (
          last && <LastRun run={last} prior={lastPrior} />
        )
      ) : live.state === 'boss' ? (
        <BossPilot data={live} wide />
      ) : live.state !== 'idle' ? (
        <LiveRun data={live} />
      ) : playing ? (
        <BetweenMaps last={runs.find((r) => !r.open && r.kind !== 'zone')} />
      ) : lastFight ? (
        <BossPilot data={{ state: 'boss', at: Date.now(), fight: fightAsLive(lastFight, [...fights, ...earlierFights]) }} wide />
      ) : (
        last && <LastRun run={last} prior={lastPrior} />
      )}

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          {/* While you play this is a section of the page; between sessions it is the page. */}
          <Heading className={ongoing || last ? 'text-lg text-text' : 'text-2xl text-text'}>
            {!session ? (
              'Session'
            ) : ongoing ? (
              <>
                Session since <span className="font-num font-semibold">{formatTime(session.start)}</span>
              </>
            ) : (
              <>
                {past ? 'Session' : 'Last session'}
                <span className={`ml-3 font-num font-semibold text-muted ${last ? 'text-base' : 'text-lg'}`}>
                  {dayFmt.format(session.start)}, {formatTime(session.start)}–{sameDay ? '' : `${dayFmt.format(session.end)}, `}
                  {formatTime(session.end)}
                </span>
              </>
            )}
          </Heading>
          <Ledger
            items={[
              // One run: the Last run panel above already shows its time and kills.
              ...(oneRun
                ? []
                : [
                    // A session of boss fights only says nothing about maps.
                    ...(runs.length || !fights.length
                      ? [
                          { value: mapCount, label: mapCount === 1 ? 'map' : 'maps' },
                          ...(zoneCount ? [{ value: zoneCount, label: zoneCount === 1 ? 'zone' : 'zones' }] : []),
                          { value: fmtClock(runTime), label: zoneCount ? 'in maps and zones' : 'in maps' },
                        ]
                      : []),
                    { value: kills.toLocaleString(), label: 'kills' },
                    ...(fights.length
                      ? [
                          { value: fights.length, label: fights.length === 1 ? 'boss fight' : 'boss fights' },
                          { value: <span className={bossKills ? AHEAD : ''}>{bossKills}</span>, label: bossKills === 1 ? 'boss kill' : 'boss kills' },
                        ]
                      : []),
                  ]),
              { value: shown.reduce((n, d) => n + d.quantity, 0), label: shown.reduce((n, d) => n + d.quantity, 0) === 1 ? 'notable drop' : 'notable drops', title: 'Notable: items in your tier list, Pul and higher runes, valuable currency and crafts you kept' },
              ...(newFinds.size && (drops ?? []).some((d) => newFinds.has(d.id))
                ? [{ value: <span className="inline-flex items-center gap-1"><NewMark size={15} />{(drops ?? []).filter((d) => newFinds.has(d.id)).length}</span>, label: 'new for the grail' }]
                : []),
              ...(fastest.size ? [{ value: <span className={AHEAD}>{fastest.size}</span>, label: fastest.size === 1 ? 'fastest clear' : 'fastest clears' }] : []),
            ]}
          />
        </div>
        {xp && <XpStrip xp={xp} ongoing={ongoing} />}
        {past ? (
          <p className="text-sm text-muted">
            An earlier session.{' '}
            <a href="#session" className="text-accent hover:underline">
              Back to {status.live ? 'the current one' : 'the latest'}
            </a>
          </p>
        ) : !status.live && (
          <p className="text-sm text-muted">
            No game running. Horazon starts recording when you start Project Diablo 2.
            {laterGame && ` A later game at ${formatTime(laterGame)} had no maps and no kills, so it isn't counted as a session.`}
          </p>
        )}
      </div>

      {drops === null ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" aria-busy="true">
          <div className="h-48 animate-pulse rounded-sm border border-line bg-panel/60" />
          <div className="h-48 animate-pulse rounded-sm border border-line bg-panel/60" />
        </div>
      ) : recap ? (
        // Between games: what you found side by side, then how the runs went side by side.
        <>
          {/* The best find stands alone; beside it how the maps went against your best, then everything
              else that dropped (so nothing shows twice), then first-time grail finds. */}
          <div className={`grid items-start gap-6 ${best || grailFinds.length ? 'lg:grid-cols-[260px_minmax(0,1fr)]' : ''}`}>
            {(best || grailFinds.length > 0) && (
              <div className="flex min-w-0 flex-col gap-6">
                {best && <BestFind drop={best} newFind={newFinds.has(best.id)} />}
                <GrailFinds drops={grailFinds} />
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-6">
              {/* One map run is the Last run panel, comparison included: no table repeats it. */}
              {mapCount > (last && last.kind !== 'zone' ? 1 : 0) && <AgainstBest runs={runs} earlier={earlier} />}
              {(!best || rest.length > 0 || others > 0) && <SessionDrops drops={rest} others={others} newFinds={newFinds} title={best ? 'Other drops' : 'Drops'} besides={!!best} />}
            </div>
          </div>
          {!oneRun && <SessionRuns runs={runs} fights={fights} fastest={fastest} title="Runs" />}
        </>
      ) : (
        <div className={`grid items-start gap-6 ${oneRun ? '' : 'lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]'}`}>
          <div className="flex min-w-0 flex-col gap-6">
            <SessionDrops drops={shown} others={others} newFinds={newFinds} title={ongoing ? 'Drops this session' : 'Drops'} />
            {grailFinds.length > 0 && <SessionDrops drops={grailFinds} others={0} newFinds={newFinds} title="New for the grail" />}
          </div>
          {!oneRun && <SessionRuns runs={runs} fights={fights} fastest={fastest} title={ongoing ? 'Runs this session' : 'Runs'} />}
        </div>
      )}
    </>
  );
}
