import { pool } from './db.js';
import { baseInfo } from './gamedata.js';

/**
 * How many monsters a map holds, for the kill counter's total and the run list's clear share.
 *
 * Exact when the game reported it (monsters left, from S14). Otherwise estimated from the
 * most monsters seen dying in a run of the map - but a run cut short (a map opened and left
 * after 20 seconds) must not pass for the whole map, so the tier vouches for it:
 *   - a tier's level is the median of its maps' best runs, leaving out maps whose best is
 *     under half the tier's top one (only ever started);
 *   - a map's own best counts once it reaches half its tier's level, else the tier's level
 *     stands in for it.
 * Monster Density isn't scaled for: most runs so far were captured without their map's
 * properties.
 */

/** A run counts as a full clear from this share of the map's population. */
export const CLEAR = 0.9;
/** A map's best run counts from this share of its tier's level (less: it was cut short). */
const CREDIBLE = 0.5;

export interface PopulationRun {
  area: number;
  code: string | null;
  deaths: number;
  /** Monsters the game reported for the run, if any. */
  exact: number | null;
}

export interface Population {
  /** Expected monsters on `area`, and where the number comes from. */
  total(area: number, code: string | null): { total: number | null; source: 'game' | 'map' | 'tier' | null };
}

// The base type names the tier ("Map T3"); the code's digit doesn't (Demon Road is t27).
export const tierOf = (code: string | null) => (code && /^Map T(\d)$/.exec(baseInfo(code)?.type ?? '')?.[1]) || null;
export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function population(runs: PopulationRun[]): Population {
  const byArea = new Map<number, PopulationRun[]>();
  for (const r of runs) byArea.set(r.area, [...(byArea.get(r.area) ?? []), r]);
  const codeOf = (area: number) => byArea.get(area)?.find((r) => r.code)?.code ?? null;
  const best = (area: number) => Math.max(0, ...(byArea.get(area) ?? []).map((r) => r.deaths));

  const bestsByTier = new Map<string, number[]>();
  for (const area of byArea.keys()) {
    const tier = tierOf(codeOf(area));
    if (tier) bestsByTier.set(tier, [...(bestsByTier.get(tier) ?? []), best(area)]);
  }
  const level = new Map(
    [...bestsByTier].map(([tier, bests]) => {
      const top = Math.max(...bests);
      return [tier, median(bests.filter((b) => b > 0 && b >= CREDIBLE * top))];
    }),
  );

  return {
    total(area, code) {
      const own = byArea.get(area) ?? [];
      const exact = own.flatMap((r) => (r.exact ? [r.exact] : []));
      if (exact.length) return { total: Math.round(median(exact)!), source: 'game' };
      const tierLevel = level.get(tierOf(code ?? codeOf(area)) ?? '') ?? null;
      const mine = best(area);
      if (mine > 0 && (tierLevel === null || mine >= CREDIBLE * tierLevel)) return { total: mine, source: 'map' };
      if (tierLevel !== null) return { total: Math.round(tierLevel), source: 'tier' };
      return { total: null, source: null };
    },
  };
}

/** Every map run with monster deaths (the run being played aside), for population(). */
export async function populationRuns(excludeRun?: number): Promise<(PopulationRun & { id: number })[]> {
  const { rows } = await pool.query<{ id: number; area: number; map_code: string | null; monsters_total: number | null; deaths: number }>(
    `SELECT r.id::int, r.area, r.map_code, r.monsters_total, sum(v.deaths_end - v.deaths_start)::int AS deaths
       FROM map_runs r JOIN area_visits v ON v.run_id = r.id
      WHERE r.kind IN ('map', 'horazon') AND r.id <> $1
      GROUP BY r.id HAVING sum(v.deaths_end - v.deaths_start) > 0`,
    [excludeRun ?? -1],
  );
  return rows.map((r) => ({ id: r.id, area: r.area, code: r.map_code, deaths: r.deaths, exact: r.monsters_total }));
}
