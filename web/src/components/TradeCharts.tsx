import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { DayGrid, RAMP } from './ActivityCalendar';
import { Floating, type Anchor } from './Floating';
import { ItemIcon } from './ItemIcon';
import { Seg, UNITS, type Unit } from './Seg';
import { yScale } from './TimeChart';
import { nameColor } from '../lib/itemStyle';
import { fmtHr } from '../lib/values';
import type { Listing, ManualSale, Range } from '../lib/api';
import { CURRENCY_BY_CODE, currencyItem } from '../lib/currencyCatalog';
import type { Item } from '../lib/types';

const PLOT_H = 180;
const M = { top: 14, right: 16, bottom: 26, left: 56 };
const DAY = 24 * 3600e3;
const height = M.top + PLOT_H + M.bottom;

const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const axisHr = (v: number) => String(Number(v.toFixed(2)));

interface Sale {
  t: number;
  hr: number;
  id: string;
  /** An item listing's item, or the currencies of a manual sale (none for a service). */
  icons: Item[];
  title: string;
  /** The listed item's colour; manual sales use plain text. */
  color: string;
  detail: string | null;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function Frame({ title, legend, controls, children }: { title: string; legend: string; controls?: ReactNode; children: ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2 rounded-sm border border-line bg-panel p-4">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-3">
          <span className="text-sm text-text">{title}</span>
          <span className="text-xs text-muted">{legend}</span>
        </span>
        {controls && <span className="flex items-center gap-2">{controls}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

function Axes({ yTicks, y, xTicks, x, pw, fmtX = dayFmt.format }: { yTicks: number[]; y: (v: number) => number; xTicks: number[]; x: (t: number) => number; pw: number; fmtX?: (t: number) => string }) {
  return (
    <>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={M.left} x2={M.left + pw} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
          <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted text-[12px] tabular-nums">
            {axisHr(v)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={t} x={x(t)} y={M.top + PLOT_H + 18} textAnchor="middle" className="fill-muted text-[12px] tabular-nums">
          {fmtX(t)}
        </text>
      ))}
    </>
  );
}

const anchorAt = (svg: Element, cx: number, cy: number): Anchor => {
  const box = svg.getBoundingClientRect();
  return { x: box.left + cx, top: box.top + cy - 8, bottom: box.top + cy + 8 };
};

/** Chart start: the first sale inside the selected range (at least a day back), so a long range
 * like a whole season doesn't squeeze recent trading into the right edge. */
const startOf = (since: number | null, sales: Sale[], now: number) => {
  const first = sales.find((s) => since === null || s.t >= since)?.t ?? since ?? now;
  return Math.min(first, now - DAY);
};

const Empty = () => <div className="flex h-full items-center justify-center text-sm text-muted">No sales in this period</div>;

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

function bucketStart(t: number, unit: Unit) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  if (unit === 'month') d.setDate(1);
  return d.getTime();
}
function nextBucket(a: number, unit: Unit) {
  const d = new Date(a);
  if (unit === 'month') d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + (unit === 'week' ? 7 : 1));
  return d.getTime();
}
/** Default bucket for a span: days up to a month, weeks up to half a year, then months. */
const autoUnit = (span: number): Unit => (span <= 31 * DAY ? 'day' : span <= 183 * DAY ? 'week' : 'month');

interface Bucket {
  a: number;
  b: number;
  sales: Sale[];
}

/** Day/week/month buckets from the period start to now, with the sales in each. */
function bucketize(all: Sale[], t0: number, now: number, unit: Unit): Bucket[] {
  const out: Bucket[] = [];
  for (let a = bucketStart(t0, unit); a <= now; a = nextBucket(a, unit)) {
    const b = nextBucket(a, unit);
    out.push({ a, b, sales: all.filter((s) => s.t >= Math.max(a, t0) && s.t < b) });
  }
  return out;
}
const bucketLabel = (a: number, unit: Unit) =>
  unit === 'week' ? `Week of ${dayFmt.format(a)}` : unit === 'month' ? monthYearFmt.format(a) : dayFmt.format(a);
const sumHr = (sales: Sale[]) => sales.reduce((n, s) => n + s.hr, 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** A bucket's best trades, for the hover card. */
function TopSales({ sales }: { sales: Sale[] }) {
  const top = [...sales].sort((a, b) => b.hr - a.hr);
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-line pt-1.5">
      {top.slice(0, 6).map((s) => (
        <li key={s.id} className="flex items-center gap-1.5">
          <span className="flex shrink-0">
            {s.icons.length ? <ItemIcon item={s.icons[0]} box={18} /> : <span className="w-[18px] text-center text-muted">·</span>}
          </span>
          <span className={`min-w-0 flex-1 truncate ${s.color}`} title={s.title}>{s.title}</span>
          <span className="shrink-0 text-text tabular-nums">{fmtHr(s.hr)}</span>
        </li>
      ))}
      {top.length > 6 && <li className="text-muted">+{top.length - 6} more</li>}
    </ul>
  );
}

/** Running total of approved sale prices within the period, one point per day/week/month. */
function AccumulatedChart({ sales: all, since, now }: { sales: Sale[]; since: number | null; now: number }) {
  const [wrap, width] = useWidth();
  const [hover, setHover] = useState<{ i: number; anchor: Anchor } | null>(null);
  const [picked, setPicked] = useState<Unit | null>(null); // null = automatic for the period

  const t0 = startOf(since, all, now);
  const unit = picked ?? autoUnit(now - t0);
  const slots = bucketize(all, t0, now, unit);
  const totals = slots.reduce<number[]>((acc, s) => [...acc, (acc.at(-1) ?? 0) + sumHr(s.sales)], []);
  const total = totals.at(-1) ?? 0;
  const count = slots.reduce((n, s) => n + s.sales.length, 0);

  const pw = Math.max(10, width - M.left - M.right);
  const slotW = pw / slots.length;
  const cx = (i: number) => M.left + (i + 0.5) * slotW;
  const { lo, hi, ticks: yTicks } = yScale(0, total, 0.01);
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * PLOT_H;
  const labelEvery = Math.max(1, Math.ceil(56 / slotW));
  const xTicks = slots.filter((_, i) => i % labelEvery === 0).map((s) => s.a);
  const xOfSlot = (a: number) => cx(slots.findIndex((s) => s.a === a));
  const fmtX = (t: number) => (unit === 'month' ? monthFmt.format(t) : dayFmt.format(t));

  const line = slots.map((_, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(totals[i]).toFixed(1)}`).join('');
  const area = `${line}L${cx(slots.length - 1).toFixed(1)},${y(0)}L${cx(0).toFixed(1)},${y(0)}Z`;

  function onMove(e: PointerEvent<SVGRectElement>) {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const i = Math.min(slots.length - 1, Math.max(0, Math.floor(px / slotW)));
    if (hover?.i !== i) setHover({ i, anchor: anchorAt(e.currentTarget.closest('svg')!, cx(i), y(totals[i])) });
  }

  const h = hover && slots[hover.i];
  return (
    <Frame
      title="Accumulated trade gains"
      legend={`${fmtHr(total)} from ${plural(count, 'sale')}`}
      controls={<Seg options={UNITS} value={unit} onChange={(u) => (setPicked(u), setHover(null))} />}
    >
      <div ref={wrap} className="relative" style={{ height }}>
        {!count ? (
          <Empty />
        ) : (
          <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={`Accumulated HR from sales by ${unit}`}>
            <Axes yTicks={yTicks} y={y} xTicks={xTicks} x={xOfSlot} pw={pw} fmtX={fmtX} />
            {/* Gold fading to the baseline: a flat fill under a running total reads as a grey slab. */}
            <defs>
              <linearGradient id="gains-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--color-series)" stopOpacity={0.28} />
                <stop offset="1" stopColor="var(--color-series)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#gains-fill)" />
            <path d={line} className="stroke-series" fill="none" strokeWidth={2} strokeLinejoin="round" />
            {slots.map((s, i) =>
              s.sales.length ? (
                <circle key={s.a} cx={cx(i)} cy={y(totals[i])} r={hover?.i === i ? 5 : 4} className="fill-series stroke-panel" strokeWidth={2} />
              ) : null,
            )}
            {h && <line x1={cx(hover.i)} x2={cx(hover.i)} y1={M.top} y2={M.top + PLOT_H} className="stroke-muted" strokeDasharray="3 3" />}
            <rect x={M.left} y={M.top} width={pw} height={PLOT_H} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        )}
        {hover && h && (
          <Floating anchor={hover.anchor} width={260}>
            <p className="text-text">{bucketLabel(h.a, unit)}</p>
            <p className="text-muted">
              {h.sales.length ? (
                <>
                  <span className="text-text tabular-nums">+{fmtHr(sumHr(h.sales))}</span> from {plural(h.sales.length, 'sale')}
                </>
              ) : (
                'No sales'
              )}
              {' · '}total <span className="text-text tabular-nums">{fmtHr(totals[hover.i])}</span>
            </p>
            {h.sales.length > 0 && <TopSales sales={h.sales} />}
          </Floating>
        )}
      </div>
    </Frame>
  );
}

const calDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/**
 * One cell per day (weeks as columns, like a contribution calendar), coloured by the HR the
 * day's sales brought in. Hovering a day shows its sales; totals sit beside the grid.
 */
function SalesCalendar({ sales: all, since, now }: { sales: Sale[]; since: number | null; now: number }) {
  const [hover, setHover] = useState<{ i: number; anchor: Anchor } | null>(null);
  // At least four weeks, so a fresh season still reads as a calendar.
  const t0 = startOfDay(Math.min(startOf(since, all, now), Math.max(since ?? -Infinity, now - 27 * DAY)));
  const days: number[] = [];
  for (let d = t0; d <= now; d = startOfDay(d + 36 * 3600e3)) days.push(d);
  const perDay = days.map((d, i) => all.filter((s) => s.t >= d && s.t < (days[i + 1] ?? now + 1)));
  const totals = perDay.map(sumHr);
  const max = Math.max(0, ...totals);
  const color = (v: number) => (v <= 0 || max === 0 ? undefined : RAMP[Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 1e-9)))]);

  const active = totals.map((v, i) => ({ v, i })).filter((d) => d.v > 0);
  const best = active.reduce<{ v: number; i: number } | null>((m, d) => (!m || d.v > m.v ? d : m), null);
  const total = sumHr(perDay.flat());
  const count = perDay.reduce((n, d) => n + d.length, 0);
  const h = hover && perDay[hover.i];

  return (
    <Frame title="Sales calendar" legend="HR from sales per day">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4 overflow-x-auto" onPointerLeave={() => setHover(null)}>
        <DayGrid
          days={days}
          render={(i, size) => (
            <div
              tabIndex={totals[i] > 0 ? 0 : -1}
              aria-label={`${calDayFmt.format(days[i])}: ${fmtHr(totals[i])}`}
              className={`rounded-[3px] outline-none ${totals[i] > 0 ? '' : 'bg-panel-hi'} ${hover?.i === i ? 'ring-1 ring-text' : ''}`}
              style={{ background: color(totals[i]), width: size, height: size }}
              onPointerEnter={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setHover({ i, anchor: { x: r.left + r.width / 2, top: r.top, bottom: r.bottom } });
              }}
            />
          )}
        />
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted">Days with sales</dt>
          <dd className="text-text tabular-nums">
            {active.length} / {days.length}
          </dd>
          <dt className="text-muted">Best day</dt>
          <dd className="text-text tabular-nums">{best ? `${fmtHr(best.v)} · ${dayFmt.format(days[best.i])}` : '—'}</dd>
          <dt className="text-muted">Per sale</dt>
          <dd className="text-text tabular-nums">{count ? fmtHr(total / count) : '—'}</dd>
        </dl>
      </div>
      {hover && h && (
        <Floating anchor={hover.anchor} width={260}>
          <p className="text-text">{calDayFmt.format(days[hover.i])}</p>
          <p className="text-muted">
            {h.length ? (
              <>
                <span className="text-text tabular-nums">{fmtHr(totals[hover.i])}</span> from {plural(h.length, 'sale')} · avg{' '}
                <span className="tabular-nums">{fmtHr(totals[hover.i] / h.length)}</span>
              </>
            ) : (
              'No sales'
            )}
          </p>
          {h.length > 0 && <TopSales sales={h} />}
        </Floating>
      )}
    </Frame>
  );
}

/** "3× Key of Terror, Ber Rune" */
export const manualSaleTitle = (m: ManualSale) =>
  m.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${CURRENCY_BY_CODE.get(i.code)?.name ?? i.code}`).join(', ');

export function TradeCharts({ listings, manualSales, range }: { listings: Listing[]; manualSales: ManualSale[]; range: Range }) {
  const sales = useMemo(
    () =>
      [
        ...listings
          .filter((l) => l.outcome === 'sold' && l.sold_hr !== null && l.closed_at)
          .map((l) => ({
            t: new Date(l.closed_at!).getTime(),
            hr: l.sold_hr!,
            id: l.id,
            icons: [l.item],
            title: l.item.name,
            color: nameColor(l.item),
            detail: l.sold_price,
          })),
        ...manualSales.map((m) => ({
          t: new Date(m.sold_at).getTime(),
          hr: m.sold_hr,
          id: `manual-${m.id}`,
          icons: m.items.map((i) => currencyItem(i.code)),
          title: m.items.length ? manualSaleTitle(m) : (m.note ?? 'Service'),
          color: 'text-text',
          detail: m.items.length ? m.note : null,
        })),
      ].sort((a, b) => a.t - b.t),
    [listings, manualSales],
  );
  // A line and a calendar need a few days of sales to say anything; the figures and sale list above
  // and below already cover one or two.
  if (new Set(sales.map((x) => new Date(x.t).toDateString())).size < 3) return null;
  const now = Math.min(Date.now(), range.until?.getTime() ?? Infinity);
  const since = range.since?.getTime() ?? null;
  // Keyed by range so a new range starts again from its automatic bucket size.
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AccumulatedChart key={`a${since}`} sales={sales} since={since} now={now} />
      <SalesCalendar sales={sales} since={since} now={now} />
    </div>
  );
}
