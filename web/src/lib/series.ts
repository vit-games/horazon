import type { StatSample } from './types';

export interface Point {
  t: number;
  v: number;
  approx: boolean;
}

export function seriesFor(samples: StatSample[], stat: string): Point[] {
  return samples
    .filter((s) => s.stat === stat)
    .map((s) => ({ t: new Date(s.t).getTime(), v: s.value, approx: s.approximate }));
}

/**
 * Several characters' lifetime counters as one, their sum at each reading. Before its first
 * reading a counter counts as that first value, so a character joins without a jump.
 */
export function sumSeries(list: Point[][]): Point[] {
  const ls = list.filter((s) => s.length);
  if (ls.length < 2) return ls[0] ?? [];
  const approx = new Set(ls.flatMap((s) => s.filter((p) => p.approx).map((p) => p.t)));
  const ts = [...new Set(ls.flatMap((s) => s.map((p) => p.t)))].sort((a, b) => a - b);
  return ts.map((t) => ({ t, v: ls.reduce((n, s) => n + (valueAt(s, t) ?? s[0].v), 0), approx: approx.has(t) }));
}

/**
 * Counter value at time t. Readings only exist when someone typed `.kills`, so
 * between two readings we interpolate linearly; after the last one we hold its
 * value; before the first one the value is unknown.
 */
export function valueAt(points: Point[], t: number): number | null {
  if (!points.length || t < points[0].t) return null;
  let lo = 0;
  let hi = points.length - 1;
  if (t >= points[hi].t) return points[hi].v;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

/**
 * The counter as last observed before `t`, no interpolation: per-bucket growth lands where it was
 * seen, so a day off between two readings or runs stays empty instead of getting a share.
 */
export function valueBefore(points: Point[], t: number): number | null {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo ? points[lo - 1].v : null;
}

/** Growth of a counter over [from, to]; clamps `from` to the first reading. */
export function gained(points: Point[], from: number | null, to: number): number | null {
  if (!points.length) return null;
  const start = from === null || from < points[0].t ? points[0].v : valueAt(points, from);
  const end = valueAt(points, to);
  return start === null || end === null ? null : end - start;
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat();

export const fmtCompact = (n: number) => compact.format(n);
export const fmtNumber = (n: number) => full.format(Math.round(n));

export function fmtDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
