export const RANGES = [
  { key: '24h', label: '24 hours', ms: 24 * 3600e3 },
  { key: '7d', label: '7 days', ms: 7 * 24 * 3600e3 },
  { key: '30d', label: '30 days', ms: 30 * 24 * 3600e3 },
  { key: 'all', label: 'All time', ms: null },
] as const;

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function dayLabel(d: Date, now = new Date()): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400e3);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return dayFmt.format(d);
}

export const formatTime = (d: Date) => timeFmt.format(d);

/** Seconds as m:ss or h:mm:ss (whole seconds passed, so a running clock never shows the next one early). */
export function fmtClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
