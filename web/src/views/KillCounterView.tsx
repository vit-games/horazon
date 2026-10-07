import { useEffect, useState } from 'react';
import { useChanges } from '../lib/live';
import { fmtRate, KillRateChart, type KillRate } from '../components/KillRateChart';
import { overlayScale, useOverlayPage } from '../lib/overlay';
import { densityColor, fetchRuns, isClear, mapContent, mapStat, runKills, type MapRun, type MapStat } from '../lib/capture';
import { runMapLabel } from '../components/MapSections';
import { EventIcon } from '../components/EventIcon';
import { Portal } from '../components/Portal';
import { fmtClock } from '../lib/time';

/**
 * Live map run tracker, in two versions from the same data:
 *   pilot (default): dense, for the player beside the game (the desktop overlay window): run time
 *     against the best clear, forces (share of the map's monsters killed, plus the current pull),
 *     kill rate, 25/50/75/100% splits and the boss against the best clear.
 *   broadcast (view=broadcast): one slim slab for viewers (OBS): map, clock and kills as the giant
 *     figures, the forces line with its split ticks, the latest split against your best.
 *   scale  size multiplier (0.5-3, default 1)
 *   edit   1 -> sample data and a drag handle (positioning the desktop overlay)
 *   sample 1 -> sample data only (the previews on the Stream page)
 * The page title is "active" while there is something to show, "idle" otherwise; the
 * desktop app shows and hides its overlay window by it.
 */

interface Split {
  share: number;
  at: number | null;
  best: number | null;
}

/** A boss fight in progress (or just won): see server killcounter.ts bossCounter. */
export interface BossFight {
  name: string;
  tier: number | null;
  tiered: boolean;
  /** Tier 0 and Uber Tristram: four entries through the summon's portals. */
  retries: boolean;
  /** From the summon: the kill time once killed. */
  seconds: number;
  killed: number | null;
  /** A finished fight (Session between games): its clock stands still. */
  over?: boolean;
  inArena: boolean;
  /** Each entry into the fight and how it ended. */
  entries: ('died' | 'killed' | 'left' | 'live')[];
  deaths: number;
  /** Each boss's HP now and at its lowest (%), in the game's order. */
  bosses: { name: string; hp: number | null; low: number | null }[];
  /** Rathma: the arena reached, 1-3. */
  phase: number | null;
  /** Fastest and median kill of this boss at this tier before. */
  best: number | null;
  median: number | null;
}

export type KillCounterData =
  | { state: 'idle' }
  | { state: 'boss'; at: number; fight: BossFight }
  | {
      state: 'running' | 'paused';
      at: number;
      /** `stats`: the map's properties when the capture read them (density, experience...). */
      run: { id: number; kind: 'map' | 'horazon'; area: number; name: string; tier: string | null; quality: string | null; stats?: MapStat[] | null };
      seconds: number;
      deaths: number;
      total: number | null;
      totalSource: 'game' | 'map' | 'tier' | null;
      historyRuns: number;
      pull: number;
      /** Kills per minute: run average and bars, the last 15 s, the best run's average. */
      rate: KillRate & { now: number | null; best: number | null };
      best: { seconds: number } | null;
      /** The map's boss: `at` once it died (active seconds), `best` in the best run. */
      boss: { name: string; at: number | null; best: number | null } | null;
      medianClear: number | null;
      delta: number | null;
      splits: Split[];
    };

const SAMPLE: KillCounterData = {
  state: 'running',
  at: Date.now(),
  run: {
    id: 0, kind: 'map', area: 146, name: 'Ancestral Trial Map', tier: '3', quality: 'rare',
    stats: [
      { stat: 'map_play_addexperience', value: 17, label: 'Experience: +17%' },
      { stat: 'map_glob_density', value: 126, label: 'Monster Density: +126%' },
      { stat: 'map_play_magicbonus', value: 85, label: 'Magic and Gold Find: +85%' },
      { stat: 'map_glob_add_mon_shriek', value: 1, label: 'Map contains Minions of Destruction' },
    ],
  },
  seconds: 164,
  deaths: 1224,
  total: 2264,
  totalSource: 'map',
  historyRuns: 5,
  pull: 132,
  rate: {
    avg: 448,
    step: 10,
    bars: [186, 384, 492, 570, 240, 462, 672, 588, 366, 144, 534, 618, 432, 336, 528, 546, 402],
    now: 528,
    best: 408,
  },
  best: { seconds: 333 },
  boss: { name: 'Nathkill The Numb', at: null, best: 292 },
  medianClear: 352,
  delta: -16,
  splits: [
    { share: 0.25, at: 79, best: 83 },
    { share: 0.5, at: 151, best: 167 },
    { share: 0.75, at: null, best: 250 },
    { share: 1, at: null, best: 333 },
  ],
};

export const formatDelta = (d: number) => `${d < 0 ? '−' : '+'}${fmtClock(Math.abs(d))}`;

const AHEAD = 'var(--color-q-set)';
const BEHIND = 'var(--color-q-red)';
const FORCES = 'var(--color-accent)';
const PULL = '#c9d8ff';
const paceColor = (diff: number | null) => (diff === null ? undefined : diff <= 0 ? AHEAD : BEHIND);

export function useKillCounter(edit: boolean) {
  const [data, setData] = useState<KillCounterData>({ state: 'idle' });
  const version = useChanges('live');
  useEffect(() => {
    if (edit) return;
    const load = () => fetch('/api/capture/live').then((r) => r.json()).then(setData, () => {});
    void load();
    // Also without events: a game gone quiet (capture stopped, crash) stops counting as in progress.
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [version, edit]);
  return edit ? SAMPLE : data;
}

/** The run clock, ticking locally between server updates while running. */
export function useClock(data: KillCounterData) {
  const [now, setNow] = useState(Date.now());
  // A boss fight's clock runs from the summon until the kill, in town between entries too.
  const running = data.state === 'running' || (data.state === 'boss' && data.fight.killed === null && !data.fight.over);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [running]);
  if (data.state === 'idle') return 0;
  if (data.state === 'boss') return data.fight.seconds + (running ? Math.max(0, now - data.at) / 1000 : 0);
  return data.seconds + (running ? Math.max(0, now - data.at) / 1000 : 0);
}

type Running = Extract<KillCounterData, { state: 'running' | 'paused' }>;

const MAP_COLOR: Record<string, string> = { rare: 'text-q-rare', magic: 'text-q-magic', unique: 'text-q-unique', set: 'text-q-set' };

/** The map's name in Cinzel, in its quality colour, after its tier. */
function MapName({ run, size, live }: { run: Running['run']; size: string; live: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ov-ink ${size}`}>
      {/* The portal turns while the run is live, as in the app's status strip. */}
      <Portal state={live ? 'live' : 'idle'} size={size === 'text-[20px]' ? 22 : 30} />
      {run.tier && <span className="shrink-0 font-num font-semibold text-muted">T{run.tier}</span>}
      <span className={`truncate font-display leading-tight font-bold ${MAP_COLOR[run.quality ?? ''] ?? 'text-text'}`}>{run.name.replace(/ Map$/, '')}</span>
    </div>
  );
}

/** Forces: share of the map's monsters killed, the latest pull brighter, ticks at the splits. */
function ForcesLine({ data, height }: { data: Running; height: string }) {
  const pct = data.total ? Math.min(1, data.deaths / data.total) : null;
  const pullPct = data.total ? Math.min(pct ?? 0, data.pull / data.total) : 0;
  return (
    <div className={`relative w-full ${height}`}>
      <div className="ov-track absolute inset-0 overflow-hidden rounded-[2px]">
        {pct !== null && (
          <>
            <div className="absolute inset-y-0 left-0" style={{ width: `${(pct - pullPct) * 100}%`, background: FORCES }} />
            <div className="absolute inset-y-0" style={{ left: `${(pct - pullPct) * 100}%`, width: `${pullPct * 100}%`, background: PULL }} />
          </>
        )}
      </div>
      {/* Split ticks stand past the bar so they hold at stream scale; a reached tick turns near-white so it reads on the blue fill. */}
      {data.splits.slice(0, -1).map((s) => (
        <div
          key={s.share}
          className="absolute -top-2 -bottom-2 w-[3px] -translate-x-1/2 rounded-full"
          style={{ left: `${s.share * 100}%`, background: s.at !== null ? '#e9eeff' : 'rgb(226 222 210 / 0.55)', boxShadow: '0 0 0 1px rgb(7 6 22 / 0.9)' }}
        />
      ))}
    </div>
  );
}

/** One split or the boss: its time once reached, its delta to the best clear, else the best to beat. */
function SplitLine({ label, at, best }: { label: string; at: number | null; best: number | null }) {
  const diff = at !== null && best !== null ? at - best : null;
  return (
    <div className="flex items-baseline justify-between gap-3 tabular-nums">
      <span className={at === null ? 'text-muted' : 'text-text'}>{label}</span>
      <span className="font-num">
        {at !== null ? (
          <>
            <span className="text-text">{fmtClock(at)}</span>
            {diff !== null && <span className="ml-2 font-semibold" style={{ color: paceColor(diff) }}>{formatDelta(diff)}</span>}
          </>
        ) : best !== null ? (
          <span className="text-muted">best {fmtClock(best)}</span>
        ) : (
          <span className="text-faint">–</span>
        )}
      </span>
    </div>
  );
}

export function KillCounterView() {
  useOverlayPage();
  const params = new URLSearchParams(location.search);
  const edit = params.get('edit') === '1';
  const sample = edit || params.get('sample') === '1';
  const broadcast = params.get('view') === 'broadcast';
  const scale = overlayScale(params);
  const data = useKillCounter(sample);
  const clock = useClock(data);
  const last = useLastRun(broadcast && !sample && data.state === 'idle');

  useEffect(() => {
    document.title = data.state === 'idle' ? 'idle' : 'active';
  }, [data.state]);

  if (data.state === 'idle') return broadcast && last ? <div className="inline-block p-4" style={{ zoom: scale }}><LastRunSlab last={last} /></div> : null;

  return (
    <div
      className={`inline-block p-4 select-none ${edit ? 'cursor-move rounded border border-dashed border-text/50' : ''}`}
      style={{ zoom: scale, ...(edit ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : {}) }}
    >
      {data.state === 'boss' ? (
        broadcast ? <BossBroadcast data={data} clock={clock} /> : <BossPilot data={data} />
      ) : broadcast ? (
        <Broadcast data={data} clock={clock} />
      ) : (
        <Pilot data={data} clock={clock} />
      )}
      {edit && <div className="mt-1 text-[13px] text-text ov-ink">Drag to move · drag an edge to resize · lock it again from the tray</div>}
    </div>
  );
}

const SESSION_GAP_MS = 45 * 60e3;

/**
 * Between maps the broadcast holds the last run's result, until the next map starts or the session
 * goes quiet (45 minutes without a map, as Session counts it): about a third of a night is town time.
 */
function useLastRun(enabled: boolean): { run: MapRun; best: number | null } | null {
  const [last, setLast] = useState<{ run: MapRun; best: number | null } | null>(null);
  const [tick, setTick] = useState(0);
  const version = useChanges('runs');
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchRuns({ since: new Date(Date.now() - SESSION_GAP_MS), until: null }).then(async ({ runs }) => {
      const run = runs.filter((x) => x.kind === 'map' && !x.open).sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
      if (!run) return !cancelled && setLast(null);
      const before = await fetchRuns({ since: null, until: new Date(run.started_at) });
      const clears = before.runs.filter((x) => x.area === run.area && isClear(x)).map((x) => x.seconds);
      if (!cancelled) setLast({ run, best: clears.length ? Math.min(...clears) : null });
    }, () => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, version, tick]);
  return enabled ? last : null;
}

/** The held result: the same slab at rest (portal still), the map, the clear time, against the best before it. */
function LastRunSlab({ last }: { last: { run: MapRun; best: number | null } }) {
  const { run, best } = last;
  const label = runMapLabel(run);
  const cleared = isClear(run);
  const diff = cleared && best !== null ? run.seconds - best : null;
  return (
    <div className="ov-slab ov-pad flex w-[640px] items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1 ov-ink">
        <div className="flex min-w-0 items-center gap-2 text-[28px]">
          <Portal state="idle" size={30} />
          {label.tier && <span className="shrink-0 font-num font-semibold text-muted">{label.tier}</span>}
          <span className={`truncate font-display leading-tight font-bold ${label.color}`}>{label.name}</span>
        </div>
        <span className="font-num text-xl font-semibold text-muted">
          Last run · {runKills(run).n.toLocaleString()} kills
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 font-num tabular-nums ov-ink">
        {/* A run left early is not a clear time: muted, and the line says where it stopped. */}
        <span className={`text-[44px] leading-none font-bold ${cleared ? 'text-text' : 'text-muted'}`}>{fmtClock(run.seconds)}</span>
        <span className="text-xl font-semibold">
          {!cleared ? (
            <span className="text-muted">{run.clear !== null ? `left at ~${Math.round(run.clear * 100)}%` : 'not a clear'}</span>
          ) : diff !== null ? (
            <span className={diff <= 0 ? 'text-q-set' : 'text-q-red'}>
              {diff === 0 ? 'equals your best' : `${formatDelta(diff)} ${diff < 0 ? 'new best' : 'vs best'}`}
            </span>
          ) : best !== null ? (
            <span className="text-muted">best {fmtClock(best)}</span>
          ) : (
            <span className="text-muted">first clear</span>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * For viewers: map on the left, kills and clock as the giant figures on the right, the forces line
 * across, and under it the latest split against your best (or the next one to beat).
 */
function Broadcast({ data, clock }: { data: Running; clock: number }) {
  const pct = data.total ? Math.min(1, data.deaths / data.total) : null;
  const reached = data.splits.filter((s) => s.at !== null);
  const last = reached.at(-1);
  const next = data.splits.find((s) => s.at === null);
  const label = (share: number) => (share === 1 ? 'Clear' : `${share * 100}%`);
  const lastDiff = last && last.at !== null && last.best !== null ? last.at - last.best : null;
  return (
    // Keyed by the latest split, so reaching one re-runs the wake light on the slab's edge.
    <div key={last?.share ?? 0} className={`ov-slab ov-pad flex w-[640px] flex-col gap-3 ${last ? 'ov-wake' : ''}`}>
      <div className="flex items-center justify-between gap-4">
        {/* Long map names (Kehjistan Market, Pandemonium Citadel) step down a size rather than truncate. */}
        <MapName run={data.run} size={data.run.name.replace(/ Map$/, '').length > 16 ? 'text-[22px]' : 'text-[28px]'} live={data.state === 'running'} />
        <div className={`flex shrink-0 items-baseline gap-5 font-num leading-none font-bold tabular-nums ov-ink ${data.state === 'paused' ? 'text-muted' : 'text-text'}`}>
          <span className="text-[44px]">
            {data.deaths.toLocaleString()}
            <span className="ml-1 text-lg font-semibold text-muted">kills</span>
          </span>
          <span className="text-[44px]">{fmtClock(clock)}</span>
        </div>
      </div>
      <ForcesLine data={data} height="h-3" />
      <div className="flex items-baseline justify-between gap-4 font-num text-xl font-semibold tabular-nums ov-ink">
        <span>
          {data.state === 'paused' ? (
            <span className="text-warn">Paused</span>
          ) : last && last.at !== null ? (
            <>
              <span className="text-text">{last.share === 1 ? 'Clear' : `${label(last.share)} split`}</span>
              {lastDiff !== null && <span className="ml-2" style={{ color: paceColor(lastDiff) }}>{formatDelta(lastDiff)} vs best</span>}
            </>
          ) : next && next.best !== null ? (
            <span className="text-muted">
              {label(next.share)} best {fmtClock(next.best)}
            </span>
          ) : (
            <span className="text-muted">First run of this map</span>
          )}
        </span>
        {data.boss?.at != null ? (
          <span className="truncate" style={{ color: paceColor(data.boss.best !== null ? data.boss.at - data.boss.best : null) ?? 'var(--color-text)' }}>
            {data.boss.name} {fmtClock(data.boss.at)}
            {data.boss.best !== null && ` ${formatDelta(data.boss.at - data.boss.best)}`}
          </span>
        ) : (
          // An estimated total says so (Principle 4): "~54%" unless the game reported the map's monsters.
          pct !== null && <span className="text-text">{data.totalSource === 'game' ? '' : '~'}{(pct * 100).toFixed(0)}% cleared</span>
        )}
      </div>
    </div>
  );
}

/** For the player beside the game: everything the run is measured by, in one dense slab. */
function Pilot({ data, clock }: { data: Running; clock: number }) {
  const pct = data.total ? Math.min(1, data.deaths / data.total) : null;
  const best = data.best?.seconds ?? null;
  const timeScale = Math.max(clock, best ?? 0, data.medianClear ?? 0) * 1.1 || 1;
  const sourceLabel =
    data.totalSource === 'game' ? 'exact' : data.totalSource === 'map' ? `est. from ${data.historyRuns} run${data.historyRuns === 1 ? '' : 's'}` : data.totalSource === 'tier' ? `est. from ${data.run.tier ? `tier ${data.run.tier}` : 'unique'} maps` : 'no estimate yet';

  return (
    <div className="ov-slab ov-pad flex w-[360px] flex-col gap-2 font-num text-[15px] text-text ov-ink">
      <div className="flex items-center justify-between gap-3">
        <MapName run={data.run} size="text-[20px]" live={data.state === 'running'} />
        {data.state === 'paused' && <span className="shrink-0 font-semibold text-warn">Paused</span>}
      </div>
      <MapLine stats={data.run.stats} />

      {/* Kills and run time, side by side and equally big */}
      <div className={`flex items-baseline justify-between text-[40px] leading-none font-bold tabular-nums ${data.state === 'paused' ? 'text-muted' : ''}`}>
        <span>
          {data.deaths.toLocaleString()}
          <span className="ml-1.5 text-[15px] font-semibold text-muted">kills</span>
        </span>
        <span>{fmtClock(clock)}</span>
      </div>

      {/* Forces */}
      <ForcesLine data={data} height="h-2.5" />
      <div className="flex items-baseline justify-between gap-3 tabular-nums">
        <span className="text-[13px] text-muted">{data.total !== null ? `${data.total.toLocaleString()} monsters, ${sourceLabel}` : sourceLabel}</span>
        <span className="font-semibold">
          {pct !== null && data.pull > 0 && data.state === 'running' && <span className="text-muted">+{((data.pull / data.total!) * 100).toFixed(1)}% </span>}
          <span className="text-lg">{pct !== null ? `${(pct * 100).toFixed(1)}%` : data.deaths.toLocaleString()}</span>
        </span>
      </div>

      {/* Run time, with the best and median clear times marked */}
      <div className="ov-track relative h-1.5 w-full rounded-[2px]">
        <div className="h-full rounded-[2px] bg-muted/70" style={{ width: `${(clock / timeScale) * 100}%` }} />
        {[best, data.medianClear].map((t, i) =>
          t ? <div key={i} className="absolute -top-1 h-3.5 w-0.5 bg-text" style={{ left: `${(t / timeScale) * 100}%` }} /> : null,
        )}
      </div>
      <div className="flex justify-end gap-3 font-semibold tabular-nums">
        <span className="mr-auto text-[13px] font-medium text-muted">map time</span>
        {best !== null && <span className="text-muted">best {fmtClock(best)}</span>}
        {data.medianClear !== null && <span className="text-muted">median {fmtClock(data.medianClear)}</span>}
        {data.delta !== null && <span style={{ color: paceColor(data.delta) }}>{formatDelta(data.delta)}</span>}
      </div>

      {/* Kills per minute: average (green when faster than the best clear), last 15 s, best clear */}
      <div className="mt-1 flex items-baseline justify-end gap-3 font-semibold tabular-nums">
        <span className="mr-auto text-[13px] font-medium text-muted">kills / min</span>
        {data.rate.now !== null && data.state === 'running' && <span className="text-muted">now {fmtRate(data.rate.now)}</span>}
        {data.rate.best !== null && <span className="text-muted">best {fmtRate(data.rate.best)}</span>}
        <span className="text-lg" style={{ color: data.rate.avg !== null && data.rate.best !== null ? paceColor(data.rate.best - data.rate.avg) : undefined }}>
          {fmtRate(data.rate.avg)}
        </span>
      </div>
      <KillRateChart rate={data.rate} width={326} height={34} color={FORCES} className="text-text" />

      {/* Splits and the boss against the best clear */}
      <div className="ov-rule mt-1 flex flex-col gap-0.5 border-t pt-2 text-base font-semibold">
        {data.splits.map((s) => (
          <SplitLine key={s.share} label={s.share === 1 ? 'Full clear' : `${s.share * 100}%`} at={s.at} best={s.best} />
        ))}
        {data.boss && <SplitLine label={data.boss.name} at={data.boss.at} best={data.boss.best} />}
      </div>
    </div>
  );
}

/** The map's density, experience and magic find, and icons for the monsters its affixes add. */
export function MapLine({ stats }: { stats?: MapStat[] | null }) {
  const density = mapStat(stats, 'map_glob_density');
  const exp = mapStat(stats, 'map_play_addexperience');
  const mf = mapStat(stats, 'map_play_magicbonus');
  const content = mapContent(stats);
  if (density === null && exp === null && mf === null && !content.length) return null;
  const pct = (v: number) => `${v > 0 ? '+' : ''}${v}%`;
  return (
    <div className="flex items-center gap-2.5 font-semibold tabular-nums">
      {content.length > 0 && (
        <span className="flex gap-1">
          {content.map((m) => (
            <EventIcon key={m.stat} kind={m.stat} size={18} title={m.label} />
          ))}
        </span>
      )}
      {density !== null && (
        <span style={{ color: densityColor(density) }}>
          {pct(density)} <span className="text-[0.85em] font-medium text-muted">dens</span>
        </span>
      )}
      {exp !== null && (
        <span className="text-text">
          {pct(exp)} <span className="text-[0.85em] font-medium text-muted">exp</span>
        </span>
      )}
      {mf !== null && (
        <span className="text-text">
          {pct(mf)} <span className="text-[0.85em] font-medium text-muted">MF</span>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- boss fights

type BossData = Extract<KillCounterData, { state: 'boss' }>;
const RATHMA_ARENAS = ['Swamp', 'Jungle', 'Void'];
const TRIES = 4;

/** The encounter's name in Cinzel after its tier, the portal live while inside the arena. */
function BossName({ f, size }: { f: BossFight; size: string }) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ov-ink ${size}`}>
      <Portal state={f.inArena && f.killed === null ? 'live' : 'idle'} size={size === 'text-[20px]' ? 22 : 30} />
      {f.tiered && <span className="shrink-0 font-num font-semibold text-muted">T{f.tier ?? '?'}</span>}
      <span className="truncate font-display leading-tight font-bold text-text">{f.name}</span>
    </div>
  );
}

/** Where the fight stands: killed, in the arena, or in town between entries. */
function BossState({ f }: { f: BossFight }) {
  if (f.killed !== null) return <span className="shrink-0 font-semibold text-q-set">Killed</span>;
  if (f.over) return <span className="shrink-0 font-semibold text-q-red">Failed</span>;
  if (!f.inArena) return <span className="shrink-0 font-semibold text-warn">In town</span>;
  return null;
}

/**
 * Entries as pips, the way Bossing draws them: red died, green the kill, a marble ring left alive,
 * the one in progress half-lit, faint the unused; "2/4" beside. "1 life" without re-entry.
 */
export function EntryPips({ f, size = 10 }: { f: BossFight; size?: number }) {
  if (!f.retries) return <span className="text-muted">1 life</span>;
  const label = `${f.entries.length} of ${TRIES} entries used`;
  return (
    <span className="flex items-center gap-1.5" role="img" aria-label={label} title={label}>
      <span className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: Math.max(TRIES, f.entries.length) }, (_, i) => {
          const t = f.entries[i];
          const look =
            t === 'died' ? 'bg-q-red' : t === 'killed' ? 'bg-q-set' : t === 'left' ? 'border-[1.5px] border-text' : t === 'live' ? 'bg-q-set/50' : 'border border-faint/60';
          return <span key={i} className={`rounded-full ${look}`} style={{ width: size, height: size }} />;
        })}
      </span>
      <span className="font-num text-muted tabular-nums" aria-hidden>
        {f.entries.length}/{TRIES}
      </span>
    </span>
  );
}

/**
 * The bosses' life bars in place of the kill count: red as the game draws a boss's life, a marble
 * tick where it got lowest (it heals a little between entries), a killed boss in green.
 */
function BossBars({ f, height, nameSize }: { f: BossFight; height: string; nameSize: string }) {
  if (f.name === 'Rathma' && f.killed === null && (f.phase ?? 0) < 3)
    return (
      <div className={`font-semibold text-muted ov-ink ${nameSize}`}>
        {f.phase ? `${RATHMA_ARENAS[f.phase - 1]} · phase ${f.phase} of 3` : 'Before the Void'}
      </div>
    );
  if (!f.bosses.length) return <div className={`font-semibold text-muted ov-ink ${nameSize}`}>No hits yet</div>;
  return (
    <div className="flex flex-col gap-2">
      {f.bosses.map((b) => (
        <div key={b.name} className="flex flex-col gap-1">
          <div className={`flex items-baseline justify-between gap-3 font-semibold tabular-nums ov-ink ${nameSize}`}>
            <span className={b.hp === 0 ? 'text-q-set' : 'text-text'}>{b.name}</span>
            <span className={b.hp === 0 ? 'text-q-set' : 'text-text'}>
              {b.hp === 0 ? 'killed' : b.hp === null ? '–' : `${b.hp}%`}
              {b.hp !== 0 && b.low !== null && b.hp !== null && b.low < b.hp && <span className="ml-2 text-[0.8em] text-muted">low {b.low}%</span>}
            </span>
          </div>
          <div className={`ov-track relative w-full overflow-visible rounded-[2px] ${height}`}>
            <div className="absolute inset-y-0 left-0 rounded-[2px]" style={{ width: `${b.hp ?? 0}%`, background: 'var(--color-q-red)' }} />
            {b.low !== null && b.hp !== null && b.low < b.hp && (
              <div className="absolute -top-1 -bottom-1 w-[3px] -translate-x-1/2 rounded-full" style={{ left: `${b.low}%`, background: '#e9eeff', boxShadow: '0 0 0 1px rgb(7 6 22 / 0.9)' }} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The kill against the best and median kill of this boss at this tier, else the times to beat. */
function KillLine({ f }: { f: BossFight }) {
  const diff = f.killed !== null && f.best !== null ? f.killed - f.best : null;
  return (
    <div className="flex items-baseline justify-end gap-3 font-semibold tabular-nums">
      <span className="mr-auto text-[13px] font-medium text-muted">kill time</span>
      {f.killed !== null && <span className="text-text">{fmtClock(f.killed)}</span>}
      {diff !== null && <span style={{ color: paceColor(diff) }}>{diff < 0 ? `${formatDelta(diff)} new best` : formatDelta(diff)}</span>}
      {f.killed === null && f.best !== null && <span className="text-muted">best {fmtClock(f.best)}</span>}
      {f.killed === null && f.median !== null && <span className="text-muted">median {fmtClock(f.median)}</span>}
      {f.best === null && f.killed === null && <span className="text-muted">first kill to set</span>}
    </div>
  );
}

/**
 * For the player beside the game (and Session, `wide`): the boss fight measured as the map timer
 * measures a run, with the bosses' HP where the kills would be.
 */
export function BossPilot({ data, wide = false }: { data: BossData; wide?: boolean }) {
  const clock = useClock(data);
  const f = data.fight;
  return (
    <div
      className={`flex flex-col gap-2.5 font-num text-[15px] text-text ${wide ? 'rounded-sm border border-line bg-panel px-5 py-4 md:px-6 md:py-5' : 'ov-slab ov-pad w-[360px] ov-ink'}`}
      aria-label={wide ? (f.over ? 'Last boss fight' : 'Current boss fight') : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <BossName f={f} size={wide ? 'text-[28px]' : 'text-[20px]'} />
        <BossState f={f} />
      </div>
      <div className={`flex items-center justify-between leading-none font-bold tabular-nums ${wide ? 'text-[56px]' : 'text-[40px]'}`}>
        <span className="text-[15px] font-semibold">
          <EntryPips f={f} size={wide ? 12 : 10} />
        </span>
        <span className={f.killed !== null ? 'text-q-set' : ''}>{fmtClock(clock)}</span>
      </div>
      <BossBars f={f} height={wide ? 'h-3' : 'h-2.5'} nameSize={wide ? 'text-base' : 'text-[15px]'} />
      <div className="ov-rule mt-1 flex flex-col gap-1 border-t pt-2">
        <KillLine f={f} />
        {f.deaths > 0 && (
          <div className="flex items-center justify-end gap-1 font-semibold text-q-red tabular-nums">
            <span className="mr-auto text-[13px] font-medium text-muted">deaths</span>
            <EventIcon kind="death" className="text-q-red" title="Deaths" />
            {f.deaths}
          </div>
        )}
      </div>
    </div>
  );
}

/** For viewers: the encounter and the clock as the giant figures, the bosses' life bars across, entries and the kill against your best. */
function BossBroadcast({ data, clock }: { data: BossData; clock: number }) {
  const f = data.fight;
  const diff = f.killed !== null && f.best !== null ? f.killed - f.best : null;
  return (
    <div key={f.killed === null ? 'fight' : 'killed'} className={`ov-slab ov-pad flex w-[640px] flex-col gap-3 ${f.killed !== null ? 'ov-wake' : ''}`}>
      <div className="flex items-center justify-between gap-4">
        <BossName f={f} size="text-[28px]" />
        <span className={`shrink-0 font-num text-[44px] leading-none font-bold tabular-nums ov-ink ${f.killed !== null ? 'text-q-set' : 'text-text'}`}>{fmtClock(clock)}</span>
      </div>
      <BossBars f={f} height="h-3" nameSize="text-xl" />
      <div className="flex items-center justify-between gap-4 font-num text-xl font-semibold tabular-nums ov-ink">
        <EntryPips f={f} size={12} />
        <span>
          {f.killed !== null ? (
            diff !== null ? (
              <span style={{ color: paceColor(diff) }}>{diff < 0 ? `${formatDelta(diff)} new best` : `${formatDelta(diff)} vs best`}</span>
            ) : (
              <span className="text-q-set">First kill</span>
            )
          ) : !f.inArena ? (
            <span className="text-warn">In town</span>
          ) : f.best !== null ? (
            <span className="text-muted">best {fmtClock(f.best)}</span>
          ) : (
            <span className="text-muted">First fight at this tier</span>
          )}
        </span>
      </div>
    </div>
  );
}
