import type { FastifyInstance } from 'fastify';
import { bossEntries, liveBossState, liveRunState, type RunProgress } from './capture.js';
import { pool } from './db.js';
import { baseInfo } from './gamedata.js';
import { killRate, perMinute, type Curve } from './killrate.js';
import { CLEAR, population, tierOf } from './population.js';

/**
 * Live kill counter for map runs (the desktop overlay and /killcounter): monster deaths
 * against the map's estimated monster total, with splits compared to the best earlier
 * clear of the same map.
 *
 * The total is what the game reported as left (exact), else estimated from earlier full
 * clears of the map, vouched for by its tier (population.ts).
 */

interface History {
  id: number;
  area: number;
  code: string | null;
  tier: string | null;
  exact: number | null;
  deaths: number;
  seconds: number;
  curve: Curve | null;
  boss: string | null;
  bossSeconds: number | null;
}

interface Estimate {
  /** The map's item code: the run's, or from earlier runs of the area (map opened before capture started). */
  mapCode: string | null;
  total: number | null;
  source: 'game' | 'map' | 'tier' | null;
  /** Earlier runs of this map with kill data. */
  runs: number;
  /** Fastest earlier run that cleared at least CLEAR of the total. */
  best: { seconds: number; deaths: number; curve: Curve | null } | null;
  /** Median time of the earlier clears. */
  medianClear: number | null;
  /** The map's boss, from earlier runs of the map. */
  boss: string | null;
  /** When the boss died in the best run (or the fastest kill when the best run has none). */
  bestBoss: number | null;
}

const SPLITS = [0.25, 0.5, 0.75, 1];
/** The "current pull": deaths in this many seconds of active time. */
const PULL_SECONDS = 15;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function history(excludeRun: number): Promise<History[]> {
  const { rows } = await pool.query<{
    id: number; area: number; map_code: string | null; monsters_total: number | null; deaths: number; seconds: number; progress: Curve | null;
    boss: string | null; boss_seconds: number | null;
  }>(
    `SELECT r.id::int, r.area, r.map_code, r.monsters_total, r.progress, r.boss, r.boss_seconds,
            sum(v.deaths_end - v.deaths_start)::int AS deaths,
            sum(extract(epoch FROM COALESCE(v.left_at, g.ended_at, g.last_event_at) - v.entered_at))::float8 AS seconds
       FROM map_runs r JOIN games g ON g.id = r.game_id JOIN area_visits v ON v.run_id = r.id
      WHERE r.kind IN ('map', 'horazon') AND r.id <> $1
      GROUP BY r.id HAVING sum(v.deaths_end - v.deaths_start) > 0`,
    [excludeRun],
  );
  return rows.map((r) => ({
    id: r.id, area: r.area, code: r.map_code, tier: tierOf(r.map_code), exact: r.monsters_total, deaths: r.deaths, seconds: r.seconds,
    curve: r.progress, boss: r.boss, bossSeconds: r.boss_seconds,
  }));
}

async function estimate(run: RunProgress): Promise<Estimate> {
  const all = await history(run.id);
  const same = all.filter((h) => h.area === run.area);
  const mapCode = run.mapCode ?? same.find((h) => h.code)?.code ?? null;
  const { total, source } = population(all).total(run.area, mapCode);
  const clears = total === null ? [] : same.filter((h) => h.deaths >= CLEAR * total);
  const best = clears.sort((a, b) => a.seconds - b.seconds)[0];
  const kills = same.flatMap((h) => (h.bossSeconds !== null ? [h.bossSeconds] : []));
  return {
    boss: same.find((h) => h.boss)?.boss ?? null,
    bestBoss: best?.bossSeconds ?? (kills.length ? Math.min(...kills) : null),
    mapCode,
    total,
    source,
    runs: same.length,
    best: best ? { seconds: best.seconds, deaths: best.deaths, curve: best.curve?.length ? best.curve : null } : null,
    medianClear: median(clears.map((h) => h.seconds)),
  };
}

// One estimate per run: earlier runs don't change while it is being played.
const estimates = new Map<number, Promise<Estimate>>();
function estimateFor(run: RunProgress) {
  let e = estimates.get(run.id);
  if (!e) {
    if (estimates.size > 20) estimates.clear();
    e = estimate(run);
    estimates.set(run.id, e);
    e.catch(() => estimates.delete(run.id));
  }
  return e;
}

/** Active seconds at which a curve first reached `deaths` (linear between samples). */
function timeAt(curve: Curve, deaths: number): number | null {
  let prev: [number, number] = [0, 0];
  for (const point of curve) {
    if (point[1] >= deaths) {
      const span = point[1] - prev[1];
      return span > 0 ? prev[0] + ((deaths - prev[1]) / span) * (point[0] - prev[0]) : point[0];
    }
    prev = point;
  }
  return null;
}

/** When the best run reached `deaths`: from its curve, or assuming an even pace. */
function bestTimeAt(best: NonNullable<Estimate['best']>, deaths: number) {
  if (deaths > best.deaths) return null;
  return best.curve ? timeAt(best.curve, deaths) : (best.seconds * deaths) / best.deaths;
}

/** Bosses of the uber encounters in the game's order; Uber Tristram and the Ancients have no tiers. */
const BOSS_ORDER = ['Lucion', 'Rathma', 'Mendeln', 'Diablo Clone', 'Mephisto', 'Diablo', 'Baal', 'Talic', 'Madawc', 'Korlic'];
const UNTIERED = new Set(['Uber Tristram', 'Uber Ancients']);

/**
 * The live boss timer: the fight's clock from the summon (town time between entries included, as
 * kill times count it), each entry and how it ended, each boss's HP now and at its lowest, and the
 * fastest and median kill of this boss at this tier before.
 */
async function bossCounter(live: NonNullable<ReturnType<typeof liveBossState>>) {
  const { rows: one } = await pool.query<{ boss: string; boss_tier: number | null; summoned_at: Date | null }>(
    'SELECT boss, boss_tier, summoned_at FROM map_runs WHERE id = $1',
    [live.runId],
  );
  const run = one[0];
  if (!run) return { state: 'idle' as const };
  // The fight: every game entered with the same summon (rejoins).
  const { rows: fight } = await pool.query<{ id: number; started_at: Date; boss_seconds: number | null; boss_detail: { bosses?: Record<string, number>; phase?: number | null } | null }>(
    `SELECT id::int, started_at, boss_seconds, boss_detail FROM map_runs
      WHERE kind = 'boss' AND (id = $1 OR (boss = $2 AND summoned_at = $3)) ORDER BY started_at`,
    [live.runId, run.boss, run.summoned_at],
  );
  const ids = fight.map((r) => r.id);
  const { rows: events } = await pool.query<{ kind: string; at: Date }>(
    `SELECT kind, at FROM map_events WHERE run_id = ANY($1::bigint[]) AND kind IN ('death', 'uber_killed')`,
    [ids],
  );
  const entries = [...(await bossEntries(ids)).values()].flat().sort((a, b) => a.at.getTime() - b.at.getTime());
  const kills = fight.map((r) => r.boss_seconds).filter((x): x is number => x !== null);
  const killed = kills.length ? Math.min(...kills) : null;
  const within = (kind: string, e: (typeof entries)[number]) =>
    events.some((x) => x.kind === kind && x.at >= e.at && x.at.getTime() <= (e.end?.getTime() ?? live.at));
  const tries = entries.map((e, i) =>
    within('uber_killed', e) ? 'killed' : within('death', e) ? 'died' : i === entries.length - 1 && killed === null && live.inArena ? 'live' : 'left',
  );
  const start = (run.summoned_at ?? fight[0].started_at).getTime();
  const tiered = !UNTIERED.has(run.boss);
  const lows: Record<string, number> = {};
  for (const r of fight) for (const [n, hp] of Object.entries(r.boss_detail?.bosses ?? {})) lows[n] = Math.min(lows[n] ?? hp, hp);
  const now = live.hp?.name === run.boss ? live.hp.bosses : {};
  const names = [...new Set([...Object.keys(lows), ...Object.keys(now)])].sort((a, b) => BOSS_ORDER.indexOf(a) - BOSS_ORDER.indexOf(b));
  const { rows: before } = await pool.query<{ boss_seconds: number }>(
    `SELECT boss_seconds FROM map_runs WHERE kind = 'boss' AND boss = $1 AND ($2 OR boss_tier IS NOT DISTINCT FROM $3)
        AND boss_seconds IS NOT NULL AND NOT (id = ANY($4::bigint[]))`,
    [run.boss, !tiered, run.boss_tier, ids],
  );
  const times = before.map((r) => r.boss_seconds);
  return {
    state: 'boss' as const,
    at: live.at,
    fight: {
      name: run.boss,
      tier: tiered ? run.boss_tier : null,
      tiered,
      retries: !tiered ? run.boss === 'Uber Tristram' : run.boss_tier !== 1 && run.boss_tier !== 2,
      seconds: killed ?? Math.max(0, (live.at - start) / 1000),
      killed,
      inArena: live.inArena,
      entries: tries,
      deaths: events.filter((e) => e.kind === 'death').length,
      bosses: names.map((name) => ({ name, hp: killed !== null ? 0 : (now[name] ?? lows[name] ?? null), low: killed !== null ? 0 : (lows[name] ?? null) })),
      phase: Math.max(0, ...fight.map((r) => r.boss_detail?.phase ?? 0)) || null,
      best: times.length ? Math.min(...times) : null,
      median: median(times),
    },
  };
}

export async function killCounter() {
  const boss = liveBossState();
  if (boss) return bossCounter(boss);
  const live = liveRunState();
  if (!live) return { state: 'idle' as const };
  const { run, state, at, totals } = live;
  const est = await estimateFor(run);
  const { seconds, deaths } = totals;
  const total = run.exactTotal ?? (est.total !== null ? Math.max(est.total, deaths) : null);
  const curve: Curve = [...run.curve, [seconds, deaths]];
  const before = [...curve].reverse().find(([t]) => t <= seconds - PULL_SECONDS);

  return {
    state,
    at,
    run: {
      id: run.id,
      kind: run.kind,
      area: run.area,
      name: run.kind === 'horazon' ? "Horazon's map" : (est.mapCode && baseInfo(est.mapCode)?.name) || `Map ${run.area}`,
      tier: tierOf(est.mapCode),
      quality: run.mapQuality,
      stats: run.mapStats,
    },
    seconds,
    deaths,
    total,
    totalSource: run.exactTotal !== null ? ('game' as const) : est.source,
    historyRuns: est.runs,
    pull: deaths - (before?.[1] ?? 0),
    /** Kills per minute: the run's average and bars over time, the last PULL_SECONDS, and the best run's average. */
    rate: {
      ...killRate(curve, seconds),
      now: seconds > 0 ? perMinute(deaths - (before?.[1] ?? 0), Math.min(seconds, PULL_SECONDS)) : null,
      best: est.best && est.best.seconds > 0 ? perMinute(est.best.deaths, est.best.seconds) : null,
    },
    best: est.best && { seconds: est.best.seconds },
    boss: (run.boss?.name ?? est.boss) && {
      name: run.boss?.name ?? est.boss!,
      at: run.boss?.seconds ?? null,
      best: est.bestBoss,
    },
    medianClear: est.medianClear,
    /** Seconds ahead (negative) or behind (positive) the best run at this many deaths. */
    delta: est.best && deaths > 0 ? (() => {
      const t = bestTimeAt(est.best, deaths);
      return t === null ? null : seconds - t;
    })() : null,
    splits: total
      ? SPLITS.map((share) => {
          const target = Math.round(share * total);
          // The full clear compares with the best run's finish, whatever it reached.
          const best = est.best && (share === 1 ? est.best.seconds : bestTimeAt(est.best, target));
          return { share, at: timeAt(curve, target), best };
        })
      : [],
  };
}

export function registerKillCounterRoutes(app: FastifyInstance) {
  app.get('/api/capture/live', () => killCounter());
}
