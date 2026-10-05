import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Floating, type Anchor } from './Floating';
import { Seg, UNITS, type Unit } from './Seg';
import { ItemIcon } from './ItemIcon';
import { nameColor } from '../lib/itemStyle';
import { tierOf, tierStyle, type TierInfo } from '../lib/tiers';
import { isNotable, rankScore } from '../lib/rank';
import { PUL } from '../lib/runes';
import { fmtNumber, valueAt, valueBefore, type Point } from '../lib/series';
import type { Drop } from '../lib/types';
import { useValues } from '../lib/values';

export interface ChartMarker {
  t: number;
  drop: Drop;
  label: string;
}

const PLOT_H = 180;
const M = { top: 34, right: 16, bottom: 26, left: 64 };
const MIN = 60e3;
const HOUR = 3600e3;
const DAY = 24 * HOUR;

export function yScale(min: number, max: number, minStep = 1) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Counters are whole numbers: by default never step below 1 (avoids 912, 912.5 -> "912, 913, 913").
  const step = Math.max(minStep, [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw)!);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

export function timeTicks(a: number, b: number, maxTicks: number): { ticks: number[]; step: number } {
  const steps = [5 * MIN, 15 * MIN, 30 * MIN, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];
  const step = steps.find((s) => (b - a) / s <= maxTicks) ?? 30 * DAY;
  const d = new Date(a);
  if (step >= DAY) d.setHours(0, 0, 0, 0);
  else if (step >= HOUR) d.setHours(Math.floor(d.getHours() / (step / HOUR)) * (step / HOUR), 0, 0, 0);
  else d.setMinutes(Math.floor(d.getMinutes() / (step / MIN)) * (step / MIN), 0, 0);
  const ticks = [];
  while (d.getTime() <= b) {
    if (d.getTime() >= a) ticks.push(d.getTime());
    if (step >= DAY) d.setDate(d.getDate() + step / DAY);
    else d.setTime(d.getTime() + step);
  }
  return { ticks, step };
}

const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

type Hover = { kind: 'point'; i: number } | { kind: 'marker'; i: number };

/**
 * Cumulative counter over time (one series, one axis) with tracked drops marked
 * on it: an icon lane above the plot and a dot where the drop sits on the line.
 * Hover: crosshair snapping to the nearest reading; markers take precedence nearby.
 */
export function TimeChart({
  title,
  seriesLabel,
  markerLabel,
  points,
  domain,
  markers,
  stale,
  emptyText,
}: {
  title: string;
  seriesLabel: string;
  markerLabel: string;
  points: Point[];
  domain: [number, number];
  markers: ChartMarker[];
  stale?: boolean;
  emptyText: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<Hover | null>(null);
  const clipId = useId();

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [t0, t1] = domain;
  const pw = Math.max(10, width - M.left - M.right);
  const x = (t: number) => M.left + ((t - t0) / (t1 - t0 || 1)) * pw;

  const view = useMemo(() => {
    const inRange = points.map((p, i) => ({ p, i })).filter(({ p }) => p.t >= t0 && p.t <= t1);
    const first = inRange[0]?.i ?? points.findIndex((p) => p.t > t1);
    const lastIdx = inRange.at(-1)?.i ?? first - 1;
    // Neighbours just outside the range keep the line continuous to the edges (clipped).
    const from = Math.max(0, (first === -1 ? points.length : first) - 1);
    const to = Math.min(points.length - 1, lastIdx + 1);
    const drawn = points.slice(from, to + 1);

    const edge = [valueAt(points, t0), valueAt(points, Math.min(t1, points.at(-1)?.t ?? t1))];
    const values = [...inRange.map(({ p }) => p.v), ...edge.filter((v): v is number => v !== null)];
    const markerVals = markers.map((m) => valueAt(points, m.t));
    return { inRange, drawn, values, markerVals };
  }, [points, markers, t0, t1]);

  const hasData = view.values.length > 0;
  const { lo, hi, ticks: yTicks } = yScale(Math.min(...view.values), Math.max(...view.values));
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * PLOT_H;
  const { ticks: xTicks, step } = timeTicks(t0, t1, Math.max(2, Math.floor(pw / 90)));
  const height = M.top + PLOT_H + M.bottom;

  const line = view.drawn.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = view.drawn.length
    ? `${line}L${x(view.drawn.at(-1)!.t).toFixed(1)},${M.top + PLOT_H}L${x(view.drawn[0].t).toFixed(1)},${M.top + PLOT_H}Z`
    : '';
  // Readings taken minutes apart pile up at wide zoom; draw a dot only once it clears the previous one.
  const dots: typeof view.inRange = [];
  for (const d of view.inRange) {
    const prev = dots.at(-1);
    if (!prev || x(d.p.t) - x(prev.p.t) >= 10 || Math.abs(y(d.p.v) - y(prev.p.v)) >= 10) dots.push(d);
  }

  const visibleMarkers = markers
    .map((m, i) => ({ m, i, v: view.markerVals[i] }))
    .filter(({ m }) => m.t >= t0 && m.t <= t1);

  function onMove(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + M.left;
    const nearMarker = visibleMarkers.find(({ m }) => Math.abs(x(m.t) - px) <= 8);
    if (nearMarker) return setHover({ kind: 'marker', i: nearMarker.i });
    let best: number | null = null;
    for (const { p, i } of view.inRange) {
      if (best === null || Math.abs(x(p.t) - px) < Math.abs(x(points[best].t) - px)) best = i;
    }
    setHover(best === null ? null : { kind: 'point', i: best });
  }

  const hoverX =
    hover?.kind === 'point' ? x(points[hover.i].t) : hover?.kind === 'marker' ? x(markers[hover.i].t) : null;

  return (
    <figure className="flex flex-col gap-2 rounded-sm border border-line bg-panel p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm text-text">{title}</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-series" />
            {seriesLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-full bg-marker" />
            {markerLabel}
          </span>
        </span>
      </figcaption>

      <div ref={wrap} className={`relative transition-opacity ${stale ? 'opacity-50' : ''}`} style={{ height }}>
        {!hasData ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">{emptyText}</div>
        ) : (
          <>
            <svg width={width} height={height} className="block overflow-visible">
              <defs>
                <clipPath id={clipId}>
                  <rect x={M.left} y={M.top - 6} width={pw} height={PLOT_H + 12} />
                </clipPath>
              </defs>

              {yTicks.map((v) => (
                <g key={v}>
                  <line x1={M.left} x2={M.left + pw} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
                  <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted text-[12px] tabular-nums">
                    {fmtNumber(v)}
                  </text>
                </g>
              ))}
              {xTicks.map((t) => (
                <text key={t} x={x(t)} y={M.top + PLOT_H + 18} textAnchor="middle" className="fill-muted text-[12px] tabular-nums">
                  {step >= DAY || new Date(t).getHours() === 0 ? dayFmt.format(t) : hourFmt.format(t)}
                </text>
              ))}

              <g clipPath={`url(#${CSS.escape(clipId)})`}>
                <path d={area} className="fill-series" fillOpacity={0.1} />
                <path d={line} className="stroke-series" fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {dots.map(({ p, i }) => (
                    <circle
                      key={i}
                      cx={x(p.t)}
                      cy={y(p.v)}
                      r={hover?.kind === 'point' && hover.i === i ? 5 : 4}
                      className={p.approx ? 'fill-panel stroke-series' : 'fill-series stroke-panel'}
                      strokeWidth={2}
                    />
                ))}
              </g>

              {visibleMarkers.map(({ m, i, v }) => (
                <g key={i}>
                  <line
                    x1={x(m.t)}
                    x2={x(m.t)}
                    y1={M.top - 6}
                    y2={v === null ? M.top + PLOT_H : y(v)}
                    className="stroke-marker"
                    strokeOpacity={0.55}
                    strokeWidth={1}
                  />
                  {v !== null && (
                    <circle cx={x(m.t)} cy={y(v)} r={hover?.kind === 'marker' && hover.i === i ? 5.5 : 4.5} className="fill-marker stroke-panel" strokeWidth={2} />
                  )}
                </g>
              ))}

              {hoverX !== null && (
                <line x1={hoverX} x2={hoverX} y1={M.top} y2={M.top + PLOT_H} className="stroke-muted" strokeOpacity={0.6} strokeWidth={1} />
              )}

              <rect
                x={M.left}
                y={M.top}
                width={pw}
                height={PLOT_H}
                fill="transparent"
                onPointerMove={onMove}
                onPointerLeave={() => setHover(null)}
              />
            </svg>

            {visibleMarkers.map(({ m, i }) => (
              <button
                key={i}
                aria-label={`${m.label}, ${fullFmt.format(m.t)}`}
                className="absolute top-0 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent"
                style={{ left: x(m.t) - 12 }}
                onPointerEnter={() => setHover({ kind: 'marker', i })}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover({ kind: 'marker', i })}
                onBlur={() => setHover(null)}
              >
                <ItemIcon item={m.drop.item} box={24} />
              </button>
            ))}

            {hover && hoverX !== null && (
              <Tooltip x={hoverX} width={width}>
                {hover.kind === 'point' ? (
                  <PointTip point={points[hover.i]} prev={points[hover.i - 1]} label={seriesLabel} />
                ) : (
                  <MarkerTip marker={markers[hover.i]} value={view.markerVals[hover.i]} label={seriesLabel} />
                )}
              </Tooltip>
            )}
          </>
        )}
      </div>
    </figure>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const W = 200;
  const left = x + 12 + W > width ? x - 12 - W : x + 12;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-sm border border-line bg-black/95 px-3 py-2 text-xs shadow-xl shadow-black"
      style={{ left: Math.max(0, left), top: M.top, width: W }}
    >
      {children}
    </div>
  );
}

function PointTip({ point, prev, label }: { point: Point; prev?: Point; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm font-semibold text-text tabular-nums">{fmtNumber(point.v)}</span>
      <span className="text-muted">{label}</span>
      <span className="text-muted">{fullFmt.format(point.t)}</span>
      {prev && point.v !== prev.v && (
        <span className="text-muted tabular-nums">+{fmtNumber(point.v - prev.v)} since previous reading</span>
      )}
      {point.approx && <span className="text-muted">Approximate time (imported log baseline)</span>}
    </div>
  );
}

function MarkerTip({ marker, value, label }: { marker: ChartMarker; value: number | null; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm font-semibold text-q-crafted">{marker.label}</span>
      <span className="text-muted">{fullFmt.format(marker.t)}</span>
      <span className="text-muted tabular-nums">
        {value === null ? `No ${label.toLowerCase()} reading before this drop` : `at ${fmtNumber(value)} ${label.toLowerCase()}`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- per day / per week

export type ChartBucket = Unit;

interface BucketPoint {
  /** Bucket start and end (end clamped to the chart range). */
  a: number;
  b: number;
  /** Counter at the end of the bucket and its growth within it. */
  v: number;
  gained: number | null;
  /** Notable drops in the bucket, best first, with their tier. */
  drops: { drop: Drop; tier: TierInfo | null }[];
}

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
/** No marker row above the bars: the plot starts near the top. */
const BUCKET_M = { ...M, top: 14 };

function bucketStart(t: number, unit: ChartBucket): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  if (unit === 'month') d.setDate(1);
  return d.getTime();
}
function nextBucket(t: number, unit: ChartBucket): number {
  const d = new Date(t);
  if (unit === 'month') d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + (unit === 'week' ? 7 : 1));
  return d.getTime();
}
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

/**
 * The counter's growth per day, week or month for longer ranges: one bar per bucket (how much
 * you played, not the running total), and a dashed line at the average over the buckets you
 * played in. Hovering a bucket (or stepping with ←/→ once the plot has focus) shows its gain and
 * its top drops, best tier first. The bucket size is the caller's.
 */
export function BucketChart({
  title,
  seriesLabel,
  points,
  domain,
  drops,
  unit,
  stale,
  emptyText,
}: {
  title: string;
  seriesLabel: string;
  points: Point[];
  domain: [number, number];
  /** Drops to summarise per bucket (only notable ones are shown). */
  drops: Drop[];
  unit: ChartBucket;
  stale?: boolean;
  emptyText: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{ i: number; anchor: Anchor } | null>(null);
  const values = useValues();
  useEffect(() => setHover(null), [unit]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [t0, t1] = domain;
  // Every day/week of the range gets a slot (empty ones stay blank); points sit mid-slot.
  const slots = useMemo(() => {
    const out: number[] = [];
    for (let a = bucketStart(t0, unit); a < t1; a = nextBucket(a, unit)) out.push(a);
    return out;
  }, [t0, t1, unit]);
  const buckets = useMemo(() => {
    const out: BucketPoint[] = [];
    for (const a of slots) {
      const b = Math.min(nextBucket(a, unit), t1);
      const v = valueBefore(points, b);
      if (v === null) continue;
      // Before the first reading the start is unknown: count from the first reading inside.
      const start = valueBefore(points, Math.max(a, t0)) ?? points.find((pt) => pt.t >= a && pt.t < b)?.v ?? null;
      const inBucket = drops
        .filter((d) => {
          const t = new Date(d.found_at).getTime();
          return t >= a && t < b;
        })
        .map((drop) => ({ drop, tier: tierOf(drop.item, values) }))
        .filter(({ drop, tier }) => isNotable(drop, PUL, tier))
        .sort((x, y) => rankScore(y.drop, new Set(), y.tier) - rankScore(x.drop, new Set(), x.tier));
      out.push({ a, b, v, gained: start === null ? null : v - start, drops: inBucket });
    }
    return out;
  }, [slots, points, drops, t0, t1, unit, values]);

  const M = BUCKET_M;
  const pw = Math.max(10, width - M.left - M.right);
  const slotW = pw / Math.max(1, slots.length);
  /** Centre of the slot that bucket start `a` belongs to. */
  const x = (a: number) => M.left + (slots.indexOf(a) + 0.5) * slotW;
  const labelEvery = Math.max(1, Math.ceil(56 / slotW));
  const gain = (p: BucketPoint) => p.gained ?? 0;
  const { lo, hi, ticks: yTicks } = yScale(0, Math.max(1, ...buckets.map(gain)));
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * PLOT_H;
  const height = M.top + PLOT_H + M.bottom;
  const barW = Math.max(2, Math.min(28, slotW * 0.62));
  // The average over buckets with any play: a day off doesn't pull "your usual" down.
  const played = buckets.filter((p) => gain(p) > 0);
  const avg = played.length ? played.reduce((n, p) => n + gain(p), 0) / played.length : null;
  const anchorFor = (el: Element, i: number): Anchor => {
    const svg = el.closest('svg') ?? el;
    const box = svg.getBoundingClientRect();
    const cx = box.left + x(buckets[i].a);
    const cy = box.top + y(gain(buckets[i]));
    return { x: cx, top: cy - 8, bottom: cy + 8 };
  };
  function onMove(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + M.left;
    let best = -1;
    buckets.forEach((p, i) => {
      if (best < 0 || Math.abs(x(p.a) - px) < Math.abs(x(buckets[best].a) - px)) best = i;
    });
    if (best >= 0 && hover?.i !== best) setHover({ i: best, anchor: anchorFor(e.currentTarget, best) });
  }
  /** Keyboard: focus lands on the newest bucket, ←/→ step, Home/End jump. */
  function onKey(e: KeyboardEvent<SVGRectElement>) {
    const last = buckets.length - 1;
    const at = hover?.i ?? last;
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const i = Math.max(0, Math.min(last, to));
    setHover({ i, anchor: anchorFor(e.currentTarget, i) });
  }

  return (
    <figure className="flex flex-col gap-2 rounded-sm border border-line bg-panel p-4">
      {avg !== null && (
        <figcaption className="flex items-center gap-2 text-xs text-muted">
          <svg width="18" height="2" aria-hidden className="shrink-0">
            <line x1="0" x2="18" y1="1" y2="1" className="stroke-marker" strokeWidth={1.5} strokeDasharray="4 3" />
          </svg>
          <span>
            <span className="text-text tabular-nums">{fmtNumber(Math.round(avg))}</span> {seriesLabel.toLowerCase()} a {unit} on average, over the{' '}
            {unit}s you played
          </span>
        </figcaption>
      )}

      <div ref={wrap} className={`relative transition-opacity ${stale ? 'opacity-50' : ''}`} style={{ height }}>
        {!buckets.length ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">{emptyText}</div>
        ) : (
          <svg width={width} height={height} className="block overflow-visible">
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={M.left} x2={M.left + pw} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
                <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted text-[12px] tabular-nums">
                  {fmtNumber(v)}
                </text>
              </g>
            ))}
            {slots.map((a, i) =>
              i % labelEvery === 0 ? (
                <text key={a} x={x(a)} y={M.top + PLOT_H + 18} textAnchor="middle" className="fill-muted text-[12px] tabular-nums">
                  {unit === 'month' ? monthFmt.format(a) : dayFmt.format(a)}
                </text>
              ) : null,
            )}
            {buckets.map((p, i) =>
              gain(p) > 0 ? (
                <rect
                  key={i}
                  x={x(p.a) - barW / 2}
                  y={y(gain(p))}
                  width={barW}
                  height={M.top + PLOT_H - y(gain(p))}
                  className="fill-series"
                  fillOpacity={hover?.i === i ? 1 : 0.75}
                />
              ) : null,
            )}
            {avg !== null && (
              <line x1={M.left} x2={M.left + pw} y1={y(avg)} y2={y(avg)} className="stroke-marker" strokeOpacity={0.8} strokeWidth={1.5} strokeDasharray="4 3" />
            )}
            <rect
              x={M.left}
              y={M.top}
              width={pw}
              height={PLOT_H}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${title} per ${unit}. Use the left and right arrow keys to read each ${unit}.`}
              className="outline-none focus-visible:stroke-accent"
              strokeWidth={1}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
              onFocus={(e) => setHover({ i: buckets.length - 1, anchor: anchorFor(e.currentTarget, buckets.length - 1) })}
              onBlur={() => setHover(null)}
              onKeyDown={onKey}
            />
          </svg>
        )}
      </div>

      {hover && (
        <Floating anchor={hover.anchor} width={300}>
          <BucketTip bucket={buckets[hover.i]} unit={unit} label={seriesLabel} />
        </Floating>
      )}
      {/* What the hover card shows, for screen readers stepping with the arrow keys. */}
      <p className="sr-only" aria-live="polite">
        {hover &&
          `${unit === 'month' ? monthYearFmt.format(buckets[hover.i].a) : weekdayFmt.format(buckets[hover.i].a)}: ${fmtNumber(gain(buckets[hover.i]))} ${seriesLabel.toLowerCase()}${buckets[hover.i].drops[0] ? `, best drop ${buckets[hover.i].drops[0].drop.item.name}` : ''}`}
      </p>
    </figure>
  );
}

function BucketTip({ bucket, unit, label }: { bucket: BucketPoint; unit: ChartBucket; label: string }) {
  const title =
    unit === 'day'
      ? weekdayFmt.format(bucket.a)
      : unit === 'month'
        ? monthYearFmt.format(bucket.a)
        : `${dayFmt.format(bucket.a)} – ${dayFmt.format(Math.min(bucket.b, nextBucket(bucket.a, 'week')) - 1)}`;
  const top = bucket.drops.slice(0, 10);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-text">{unit === 'week' ? `Week of ${title}` : title}</p>
      <p className="text-muted">
        {bucket.gained !== null && (
          <>
            <span className="text-text tabular-nums">+{fmtNumber(bucket.gained)}</span> {label.toLowerCase()} ·{' '}
          </>
        )}
        <span className="tabular-nums">{fmtNumber(bucket.v)}</span> total
      </p>
      {top.length === 0 ? (
        <p className="text-muted">No notable drops</p>
      ) : (
        <ul className="-mx-1.5 flex flex-col gap-0.5">
          {top.map(({ drop, tier }) => (
            // Top-tier drops get the drop list's tier colouring (pale gold → blood red).
            <li key={drop.id} style={tierStyle(tier)} className={`flex items-center gap-1.5 py-0.5 pr-1 pl-1.5 ${tier ? 'tier-row font-medium' : ''}`}>
              <ItemIcon item={drop.item} box={18} />
              <span className={`truncate ${nameColor(drop.item)}`}>{drop.item.name}</span>
              {drop.quantity > 1 && <span className="text-muted">×{drop.quantity}</span>}
            </li>
          ))}
          {bucket.drops.length > 10 && <li className="text-muted">+{bucket.drops.length - 10} more</li>}
        </ul>
      )}
    </div>
  );
}
