/** Kills per minute over a run (server/src/killrate.ts). */
export interface KillRate {
  avg: number | null;
  /** Seconds per bar. */
  step: number;
  bars: number[];
}

export const fmtRate = (n: number | null) => (n === null ? '—' : n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1));

/**
 * Bars of kills/minute over the run, with the run's average as a dashed line. `color`
 * is any CSS color (the overlay passes its theme variable).
 */
export function KillRateChart({
  rate,
  width,
  height,
  color = 'var(--color-series)',
  className = '',
}: {
  rate: KillRate;
  width: number;
  height: number;
  color?: string;
  className?: string;
}) {
  const { bars, avg, step } = rate;
  if (bars.length < 2) return null;
  const max = Math.max(...bars, avg ?? 0) || 1;
  const gap = bars.length > 40 ? 0 : 1;
  const w = width / bars.length;
  const y = (v: number) => height - (v / max) * (height - 1);
  return (
    <svg width={width} height={height} className={`block ${className}`} role="img" aria-label="Kills per minute over the run">
      <title>{`Kills per minute, ${step} s per bar · average ${fmtRate(avg)} · peak ${fmtRate(Math.max(...bars))}`}</title>
      {bars.map((v, i) => (
        <rect key={i} x={i * w} y={y(v)} width={Math.max(1, w - gap)} height={height - y(v)} fill={color} opacity={0.85} />
      ))}
      {avg !== null && avg > 0 && (
        <line x1={0} x2={width} y1={y(avg)} y2={y(avg)} stroke="currentColor" strokeWidth={1} strokeDasharray="3 2" opacity={0.75} />
      )}
    </svg>
  );
}
