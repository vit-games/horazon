import { useEffect, useRef, useState } from 'react';
import { RAMP } from './ActivityCalendar';

export interface CalendarDay {
  /** Local date, YYYY-MM-DD. */
  key: string;
  label: string;
  count: number;
  /** Rows listed that day but not in the count ("3 grail finds"). */
  also?: string;
}

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const keyOf = (d: Date) => d.toLocaleDateString('sv');
const monthOf = (key: string) => new Date(`${key.slice(0, 7)}-01T12:00`);

/**
 * The day picker of the drop list: a button with the day, opening a month calendar whose days
 * are shaded by their drops (the shared activity ramp: brighter for more); days with drops can be picked.
 */
export function DayCalendar({
  days,
  value,
  onPick,
  unit = ['drop', 'drops'],
}: {
  days: CalendarDay[];
  value: string;
  onPick: (key: string) => void;
  /** What a day's count counts, singular and plural ("notable", "grail finds"). */
  unit?: [string, string];
}) {
  const say = (n: number) => `${n} ${n === 1 ? unit[0] : unit[1]}`;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthOf(value));
  const box = useRef<HTMLSpanElement>(null);
  const byKey = new Map(days.map((d) => [d.key, d]));
  const current = byKey.get(value);
  const max = Math.max(1, ...days.map((d) => d.count));

  useEffect(() => setMonth(monthOf(value)), [value]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // Monday-first grid of the month, padded to whole weeks.
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const inMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + inMonth) / 7) * 7 }, (_, i) => {
    const n = i - lead + 1;
    return n >= 1 && n <= inMonth ? new Date(month.getFullYear(), month.getMonth(), n) : null;
  });
  const keys = days.map((d) => d.key).sort();
  const shift = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  // Step only as far as there are drops.
  const canBack = keys.length > 0 && keys[0] < keyOf(first);
  const canForward = keys.length > 0 && keys[keys.length - 1] >= keyOf(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  const today = keyOf(new Date());
  const navBtn = 'rounded-sm px-2 text-muted hover:text-text disabled:opacity-30';

  return (
    <span ref={box} className="relative">
      <button
        className="flex items-center gap-2 rounded-sm border border-line bg-panel px-2 py-0.5 text-base font-semibold text-text hover:border-accent/60"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {current?.label ?? value}
        <span className="text-sm text-muted tabular-nums">
          · {say(current?.count ?? 0)}
          {current?.also && <> · {current.also}</>}
        </span>
        <span className="text-xs text-muted">▾</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Pick a day"
          className="absolute top-full left-0 z-20 mt-1 w-[280px] rounded-sm border border-line bg-panel p-3 text-sm font-normal tracking-normal normal-case shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <button className={navBtn} disabled={!canBack} onClick={() => shift(-1)} aria-label="Previous month">
              ‹
            </button>
            <span className="text-text">{monthFmt.format(month)}</span>
            <button className={navBtn} disabled={!canForward} onClick={() => shift(1)} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} className="pb-1 text-xs text-muted">
                {w}
              </span>
            ))}
            {cells.map((d, i) => {
              if (!d) return <span key={i} />;
              const k = keyOf(d);
              const day = byKey.get(k);
              const share = day ? day.count / max : 0;
              const shade = day ? RAMP[Math.min(RAMP.length - 1, Math.floor(share * (RAMP.length - 1e-9)))] : undefined;
              return (
                <button
                  key={k}
                  disabled={!day}
                  onClick={() => {
                    onPick(k);
                    setOpen(false);
                  }}
                  title={day ? `${day.label} · ${say(day.count)}` : undefined}
                  aria-pressed={k === value}
                  className={`aspect-square rounded-sm font-num text-sm font-semibold tabular-nums ${
                    day ? 'hover:outline hover:outline-1 hover:outline-offset-1 hover:outline-text/60' : 'font-normal text-faint'
                  } ${k === value ? 'outline-2 outline-offset-1 outline-text' : ''} ${k === today && !day ? 'border border-line' : ''}`}
                  // Pale cells (many drops) take dark figures, deep ones light.
                  style={{ background: shade, color: day ? (share >= 0.7 ? 'var(--color-bg)' : 'var(--color-text)') : undefined }}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted">
            <span>Fewer</span>
            <span className="h-1.5 flex-1 rounded-sm" style={{ background: `linear-gradient(to right, ${RAMP.join(',')})` }} />
            <span>More drops</span>
          </div>
        </div>
      )}
    </span>
  );
}
