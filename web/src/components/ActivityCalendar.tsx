import { useEffect, useMemo, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { EventIcon } from './EventIcon';
import { Floating, type Anchor } from './Floating';
import { ItemIcon } from './ItemIcon';
import { EVENT_LABEL, areaName, isShard, mapInfo, type CaptureGame, type MapRun } from '../lib/capture';
import { nameColor } from '../lib/itemStyle';
import { isNotable, rankScore } from '../lib/rank';
import { PUL } from '../lib/runes';
import { tierOf } from '../lib/tiers';
import { useValues } from '../lib/values';
import { fmtCompact, fmtNumber, valueAt, type Point } from '../lib/series';
import type { Drop } from '../lib/types';

/**
 * Activity heat, shared by every calendar: more light for more play, from dim indigo through
 * glyph blue to near white (the portal's light). Not the tier ramp: that one means item value.
 */
export const RAMP = ['#262b58', '#2b346d', '#2f3d82', '#344697', '#394fac', '#3e59c1', '#506fd1', '#6385e2', '#759bf2', '#8cb2ff', '#b6ceff', '#e0eaff'];
const HOUR = 3600e3;
/** Ranges up to a week get the hour grid; longer ones (and all time) one cell per day. */
const HOURLY_MAX_DAYS = 8;
const MAX_DAYS = 3 * 366;
/** The calendar starts where the data does, but shows at least four weeks (as the sales calendar). */
const MIN_DAYS = 28;

export type CalendarMetric = 'kills' | 'maps' | 'drops' | 'shards';

interface Bucket {
  kills: number;
  runs: MapRun[];
  events: string[];
  drops: Drop[];
  shards: number;
  /** The day's kills come from `.kills` readings alone (no captured game): known per day, not per hour. */
  readOnly?: boolean;
}
const empty = (): Bucket => ({ kills: 0, runs: [], events: [], drops: [], shards: 0 });

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const nextDay = (t: number) => startOfDay(t + 36 * HOUR);
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

/**
 * Activity over the selected range. Short ranges show a day x hour grid (newest day
 * first); longer ones a calendar with one cell per day (weeks as columns). Hovering a
 * cell (or a day label) shows kills, maps, map events and the best drops; clicking one picks its day.
 */
export function ActivityCalendar({
  from,
  to,
  games,
  runs,
  drops,
  metric,
  dataStart,
  readings = [],
  picked = null,
  onPick,
}: {
  from: number | null;
  to: number;
  games: CaptureGame[];
  runs: MapRun[];
  drops: Drop[];
  metric: CalendarMetric;
  /** The first data the page's other charts show (stat readings included), so both start on one day. */
  dataStart?: number;
  /** The kill counter the per-day charts draw (readings and captured games), to fill days no game was captured on. */
  readings?: Point[];
  /** The picked day (its local midnight), outlined; clicking a day picks it, clicking it again lets go. */
  picked?: number | null;
  onPick?: (day: number | null) => void;
}) {
  /** Hovered cell (or day label) and where it is on screen, for the floating card. */
  const [hover, setHover] = useState<{ day: number; hour: number | null; anchor: Anchor } | null>(null);

  // The card is positioned against the viewport: drop it when the page scrolls.
  useEffect(() => {
    if (!hover) return;
    const clear = () => setHover(null);
    window.addEventListener('scroll', clear, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', clear, { capture: true });
  }, [hover]);

  const values = useValues();
  const { days, cells, totals, hourly, truncated } = useMemo(() => {
    const firstData = Math.min(
      ...games.map((g) => new Date(g.started_at).getTime()),
      ...drops.map((d) => new Date(d.found_at).getTime()),
      dataStart ?? to,
      to,
    );
    // Days of the selected range from the first data on, oldest first: a season that started
    // months before you did shouldn't be a wall of empty weeks.
    const end = startOfDay(to);
    // Short ranges (a day, a week) get the hour grid, whatever the data; so does a longer range you
    // only started playing in this week (a month grid of three lit days says little).
    const short = from !== null && (end - startOfDay(from)) / (24 * HOUR) <= HOURLY_MAX_DAYS;
    const firstDay = startOfDay(Math.max(from ?? -Infinity, firstData));
    const hourly = short || (end - firstDay) / (24 * HOUR) < HOURLY_MAX_DAYS;
    let start = short ? startOfDay(from!) : hourly ? firstDay : startOfDay(Math.max(from ?? -Infinity, Math.min(firstData, end - (MIN_DAYS - 1) * 24 * HOUR)));
    const truncated = (end - start) / (24 * HOUR) > MAX_DAYS;
    if (truncated) start = startOfDay(end - MAX_DAYS * 24 * HOUR);
    const days: number[] = [];
    for (let d = start; d <= end; d = nextDay(d)) days.push(d);
    const index = new Map(days.map((d, i) => [d, i]));
    const cells = hourly ? days.map(() => Array.from({ length: 24 }, empty)) : [];
    const totals = days.map(empty);
    const at = (t: number) => {
      const i = index.get(startOfDay(t));
      return i === undefined ? null : { i, h: new Date(t).getHours() };
    };
    const add = (t: number, f: (b: Bucket) => void) => {
      const c = at(t);
      if (!c) return;
      f(totals[c.i]);
      if (hourly) f(cells[c.i][c.h]);
    };

    for (const g of games) {
      // The kill counter only reports per game: spread a game's kills over its hours.
      const a = new Date(g.started_at).getTime();
      const b = Math.max(a + 1, new Date(g.ended_at).getTime());
      const kills = g.deaths || g.kills;
      for (let t = a - (a % HOUR); t < b; t += HOUR) {
        const share = (Math.min(b, t + HOUR) - Math.max(a, t)) / (b - a);
        if (share > 0) add(Math.max(a, t), (x) => (x.kills += kills * share));
      }
    }
    for (const r of runs) {
      add(new Date(r.started_at).getTime(), (x) => x.runs.push(r));
      for (const e of r.events) if (e.kind in EVENT_LABEL) add(new Date(e.at).getTime(), (x) => x.events.push(e.kind));
    }
    // Days with kills read from the chat log but no captured game: the day's gain, as the per-day bars show it.
    days.forEach((d, i) => {
      if (totals[i].kills > 0) return;
      const end = Math.min(nextDay(d), to);
      const inside = readings.find((p) => p.t >= d && p.t < end);
      const start = valueAt(readings, d) ?? inside?.v ?? null;
      const last = valueAt(readings, end - 1);
      if (start !== null && last !== null && last > start) {
        totals[i].kills = last - start;
        totals[i].readOnly = true;
      }
    });
    // Only notable drops count (the app's one rule, Pul+ runes).
    for (const d of drops) {
      if (isShard(d.item.base_code)) add(new Date(d.found_at).getTime(), (x) => (x.shards += d.quantity));
      if (!d.ignored && isNotable(d, PUL, tierOf(d.item, values))) add(new Date(d.found_at).getTime(), (x) => x.drops.push(d));
    }
    return { days, cells, totals, hourly, truncated };
  }, [from, to, games, runs, drops, values, dataStart, readings]);

  const value = (b: Bucket) =>
    metric === 'kills' ? b.kills : metric === 'maps' ? b.runs.filter((r) => r.kind === 'map').length : metric === 'shards' ? b.shards : b.drops.length;
  const max = Math.max(0, ...(hourly ? cells.flat() : totals).map(value));
  const color = (v: number) => (v <= 0 || max === 0 ? undefined : RAMP[Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 1e-9)))]);
  const format = (n: number) => (metric === 'kills' ? fmtCompact(n) : fmtNumber(n));

  const show = (e: PointerEvent | FocusEvent, day: number, hour: number | null) => {
    const cell = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHover({ day, hour, anchor: { x: cell.left + cell.width / 2, top: cell.top, bottom: cell.bottom } });
  };
  const handlers = (day: number, hour: number | null) => ({
    onPointerEnter: (e: PointerEvent) => show(e, day, hour),
    onFocus: (e: FocusEvent) => show(e, day, hour),
    onBlur: () => setHover(null),
    ...(onPick && {
      role: 'button',
      'aria-pressed': days[day] === picked,
      onClick: () => onPick(days[day] === picked ? null : days[day]),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onPick(days[day] === picked ? null : days[day]);
      },
    }),
  });

  const hovered = hover ? (hover.hour === null ? totals[hover.day] : cells[hover.day][hover.hour]) : null;
  const cellClass = (v: number, on: boolean) =>
    `rounded-[3px] outline-none ${v > 0 ? '' : 'bg-panel-hi'} ${on ? 'ring-1 ring-text' : ''} ${onPick && v > 0 ? 'cursor-pointer' : ''}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto" onPointerLeave={() => setHover(null)}>
        {hourly ? (
          <div className="grid min-w-[600px] grid-cols-[84px_repeat(24,minmax(0,1fr))] gap-[2px] text-xs text-muted">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center tabular-nums">
                {h % 3 === 0 ? h : ''}
              </span>
            ))}
            {days.map((day, i) => i).reverse().map((i) => (
              <div key={days[i]} className="contents">
                <button
                  className={`self-center truncate pr-1 text-left hover:text-text ${hover?.day === i && hover.hour === null ? 'text-text' : ''} ${
                    days[i] === picked ? 'font-semibold text-accent' : ''
                  }`}
                  {...handlers(i, null)}
                >
                  {dayFmt.format(days[i])}
                </button>
                {/* Kills known only for the whole day (a .kills reading, no captured game): one hatched band, no hours. */}
                {metric === 'kills' && totals[i].readOnly ? (
                  <div
                    tabIndex={0}
                    className="col-span-24 flex h-5 items-center rounded-[3px] px-2 text-[13px] text-muted outline-none focus-visible:ring-1 focus-visible:ring-text"
                    style={{ background: 'repeating-linear-gradient(135deg, var(--color-panel-hi) 0 6px, transparent 6px 12px)' }}
                    aria-label={`${dayFmt.format(days[i])}: ${format(totals[i].kills)} kills from a .kills reading, no hours`}
                    title="From a .kills reading kept from an older Horazon version: the day's kills are known, the hours aren't"
                  >
                    {format(totals[i].kills)} kills · from .kills, no hours
                  </div>
                ) : cells[i].map((b, h) => {
                  const v = value(b);
                  return (
                    <div
                      key={h}
                      tabIndex={v > 0 ? 0 : -1}
                      aria-label={`${dayFmt.format(days[i])} ${hourLabel(h)}: ${format(v)} ${metric}`}
                      className={`h-5 ${cellClass(v, hover?.day === i && hover.hour === h)}`}
                      style={{ background: color(v) }}
                      {...handlers(i, h)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
            <DayGrid
              days={days}
              render={(i, size) => {
                const v = value(totals[i]);
                return (
                  <div
                    tabIndex={v > 0 ? 0 : -1}
                    aria-label={`${dayFmt.format(days[i])}: ${format(v)} ${metric}`}
                    className={`${cellClass(v, hover?.day === i)} ${days[i] === picked ? 'ring-2 ring-accent' : ''}`}
                    style={{ background: color(v), width: size, height: size }}
                    {...handlers(i, null)}
                  />
                );
              }}
            />
            <DaySummary days={days} totals={totals} value={value} format={format} metric={metric} />
          </div>
        )}
        {hover && hovered && (
          <Cloud
            bucket={hovered}
            title={`${dayFmt.format(days[hover.day])}${hover.hour === null ? '' : ` · ${hourLabel(hover.hour)}–${hourLabel((hover.hour + 1) % 24)}`}`}
            anchor={hover.anchor}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span className="flex items-center gap-2">
          0
          <span className="h-2 w-32 rounded-sm" style={{ background: `linear-gradient(to right, ${RAMP.join(',')})` }} />
          {format(max)} {metric} per {hourly ? 'hour' : 'day'}
        </span>
        <span>
          Hover for details{onPick ? ' · click a day for its sessions' : ''}{truncated ? ' · showing the last 3 years' : ''}
        </span>
      </div>
    </div>
  );
}

/** Weeks as columns (Monday on top), month names above the week a month starts in. */
export function DayGrid({ days, render }: { days: number[]; render: (i: number, size: number) => ReactNode }) {
  const weeks: (number | null)[][] = [];
  const lead = (new Date(days[0]).getDay() + 6) % 7;
  let week: (number | null)[] = Array(lead).fill(null);
  days.forEach((_, i) => {
    week.push(i);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  });
  if (week.length) weeks.push([...week, ...Array(7 - week.length).fill(null)]);
  // Fewer weeks get bigger cells so a month or a season still fills the panel.
  const size = weeks.length <= 8 ? 26 : weeks.length <= 16 ? 22 : weeks.length <= 30 ? 18 : 14;

  // A month label sits over the week holding the 1st; the first column only gets one
  // when the next label is far enough away not to collide.
  const labels = weeks.map((w, wi) => {
    const first = w.find((i): i is number => i !== null && new Date(days[i]).getDate() === 1);
    return first !== undefined ? monthFmt.format(days[first]) : null;
  });
  const nextLabel = labels.findIndex((l, i) => i > 0 && l);
  if (!labels[0] && (nextLabel === -1 || nextLabel * (size + 3) >= 28)) labels[0] = monthFmt.format(days[0]);

  return (
    <div className="inline-flex gap-[3px] text-xs text-muted">
      <div className="mr-1 flex flex-col gap-[3px]" style={{ paddingTop: 17 }}>
        {WEEKDAYS.map((d, i) => (
          <span key={i} style={{ height: size, lineHeight: `${size}px` }}>
            {d}
          </span>
        ))}
      </div>
      {weeks.map((w, wi) => (
        <div key={wi} className="flex flex-col gap-[3px]">
          <span className="h-[14px] overflow-visible leading-[14px] whitespace-nowrap" style={{ width: size }}>
            {labels[wi] ?? ''}
          </span>
          {w.map((i, di) => (i === null ? <span key={di} style={{ height: size, width: size }} /> : <div key={di}>{render(i, size)}</div>))}
        </div>
      ))}
    </div>
  );
}

/** Totals beside the day calendar. */
function DaySummary({ days, totals, value, format, metric }: { days: number[]; totals: Bucket[]; value: (b: Bucket) => number; format: (n: number) => string; metric: string }) {
  const active = totals.map((b, i) => ({ i, v: value(b) })).filter((d) => d.v > 0);
  const best = active.reduce<{ i: number; v: number } | null>((m, d) => (!m || d.v > m.v ? d : m), null);
  const total = active.reduce((n, d) => n + d.v, 0);
  const maps = totals.reduce((n, b) => n + b.runs.filter((r) => r.kind === 'map').length, 0);
  const row = 'flex justify-between gap-6';
  return (
    <dl className="flex min-w-48 flex-col gap-1 text-xs text-muted">
      <div className={row}>
        <dt>Active days</dt>
        <dd className="text-text tabular-nums">
          {active.length} / {days.length}
        </dd>
      </div>
      <div className={row}>
        <dt>Maps run</dt>
        <dd className="text-text tabular-nums">{fmtNumber(maps)}</dd>
      </div>
      <div className={row}>
        <dt>Avg {metric} per active day</dt>
        <dd className="text-text tabular-nums">{active.length ? format(total / active.length) : '—'}</dd>
      </div>
      <div className={row}>
        {/* "Busiest": the most play, kept apart from Activity's Best drop days. */}
        <dt>Busiest day</dt>
        <dd className="text-text tabular-nums">{best ? `${dayFmt.format(days[best.i])} · ${format(best.v)}` : '—'}</dd>
      </div>
    </dl>
  );
}

/** The hover card: what happened in an hour or a day. */
function Cloud({ bucket, title, anchor }: { bucket: Bucket; title: string; anchor: Anchor }) {
  const maps = bucket.runs.filter((r) => r.kind === 'map');
  const zones = [...new Set(bucket.runs.filter((r) => r.kind === 'zone').map((r) => areaName(r.area)))];
  const horazon = bucket.runs.filter((r) => r.kind === 'horazon').length;
  const time = bucket.runs.reduce((n, r) => n + r.seconds, 0);
  const byMap = new Map<string, number>();
  for (const r of maps) {
    const m = mapInfo(r.map_code);
    const key = `${m.tier ? `${m.tier} ` : ''}${r.map_name && r.map_quality === 'unique' ? r.map_name : m.name}`;
    byMap.set(key, (byMap.get(key) ?? 0) + 1);
  }
  const events = new Map<string, number>();
  for (const e of bucket.events) events.set(e, (events.get(e) ?? 0) + 1);
  const top = [...bucket.drops].sort((a, b) => rankScore(b, new Set(), null) - rankScore(a, new Set(), null)).slice(0, 5);
  const nothing = !bucket.kills && !maps.length && !zones.length && !bucket.drops.length && !bucket.shards && !events.size;

  return (
    <Floating anchor={anchor}>
      <p className="mb-1.5 text-text">{title}</p>
      {nothing ? (
        <p className="text-muted">Nothing tracked</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted">
            <span className="text-text tabular-nums">{fmtNumber(bucket.kills)}</span> kills ·{' '}
            <span className="text-text tabular-nums">{maps.length}</span> map{maps.length === 1 ? '' : 's'}
            {time > 0 && <> · {Math.round(time / 60)} min inside</>} ·{' '}
            <span className="text-text tabular-nums">{bucket.drops.length}</span> notable drop{bucket.drops.length === 1 ? '' : 's'}
            {bucket.shards > 0 && (
              <>
                {' '}· <span className="text-text tabular-nums">{bucket.shards}</span> shard{bucket.shards === 1 ? '' : 's'}
              </>
            )}
          </p>
          {byMap.size > 0 && (
            <p className="text-muted">
              {[...byMap].map(([name, n], i) => (
                <span key={name}>
                  {i ? ', ' : ''}
                  <span className="text-text">{name}</span>
                  {n > 1 && ` ×${n}`}
                </span>
              ))}
            </p>
          )}
          {zones.length > 0 && <p className="text-muted">Zones: <span className="text-text">{zones.join(', ')}</span></p>}
          {(events.size > 0 || horazon > 0) && (
            <div className="flex flex-wrap gap-1">
              {[...events].map(([kind, n]) => (
                <span key={kind} className="flex items-center gap-1 rounded-sm border border-line px-1.5 text-text">
                  <EventIcon kind={kind} size={12} />
                  {EVENT_LABEL[kind]}
                  {n > 1 && ` ×${n}`}
                </span>
              ))}
            </div>
          )}
          {top.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {top.map((d) => (
                <li key={d.id} className="flex items-center gap-1.5">
                  <ItemIcon item={d.item} box={18} />
                  <span className={`truncate ${nameColor(d.item)}`}>{d.item.name}</span>
                  {d.quantity > 1 && <span className="text-muted">×{d.quantity}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Floating>
  );
}
