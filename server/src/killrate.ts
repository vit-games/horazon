/** [active seconds, monster deaths] samples of a run (map_runs.progress). */
export type Curve = [number, number][];

export interface KillRate {
  /** Monster deaths per minute over the whole run. */
  avg: number | null;
  /** Seconds per bar. */
  step: number;
  /** Deaths per minute in each `step`-second slice of the run, oldest first. */
  bars: number[];
}

/** Deaths over `seconds`, per minute, to one decimal. */
export const perMinute = (deaths: number, seconds: number) => Math.round((deaths / seconds) * 600) / 10;

/**
 * Kill rate (per minute) over a run, from its curve. Samples are only taken when the death count
 * changes (at most every 2 s), so the curve is read as a step: deaths at time t are
 * those of the last sample at or before t. Bars get wider for longer runs (multiples of
 * 5 s, about `count` of them).
 */
export function killRate(curve: Curve, seconds: number, count = 30): KillRate {
  if (seconds <= 0) return { avg: null, step: 5, bars: [] };
  const deaths = curve.at(-1)?.[1] ?? 0;
  const step = Math.max(5, Math.ceil(seconds / count / 5) * 5);
  const bars: number[] = [];
  let i = 0;
  let before = 0;
  for (let start = 0; start < seconds; start += step) {
    const end = Math.min(start + step, seconds);
    // A sliver at the end is mostly noise.
    if (end - start < Math.min(step / 2, 3)) break;
    while (i < curve.length && curve[i][0] <= end) i++;
    const at = i ? curve[i - 1][1] : 0;
    bars.push(perMinute(at - before, end - start));
    before = at;
  }
  return { avg: perMinute(deaths, seconds), step, bars };
}
