import { useId } from 'react';

export type PortalState = 'live' | 'idle' | 'error';

const COLORS: Record<PortalState, { ring: string; glow: string; core: string; deep: string }> = {
  live: { ring: '#9dbcff', glow: '#5b82ff', core: '#d6e3ff', deep: '#1d2f8a' },
  idle: { ring: '#4a5380', glow: '#2a3260', core: '#5a6390', deep: '#141832' },
  error: { ring: '#ef5d5d', glow: '#a3262a', core: '#ffb3a8', deep: '#3a0c12' },
};

/**
 * Horazon's portal: the O of the wordmark and the app's status light. It turns while the
 * capture is live, sits dim and still when idle, and cracks red when a source is failing.
 */
export function Portal({ state, size = 28, title }: { state: PortalState; size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  const c = COLORS[state];
  return (
    <svg
      className="portal shrink-0"
      data-state={state}
      width={size * (40 / 52)}
      height={size}
      viewBox="0 0 40 52"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={`${id}c`} cx="50%" cy="55%" r="55%">
          <stop offset="0" stopColor={c.core} />
          <stop offset="0.45" stopColor={c.glow} />
          <stop offset="1" stopColor={c.deep} />
        </radialGradient>
        <clipPath id={`${id}k`}>
          <ellipse cx="20" cy="26" rx="14" ry="20" />
        </clipPath>
        <filter id={`${id}g`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      {state !== 'idle' && <ellipse cx="20" cy="26" rx="16" ry="22" fill="none" stroke={c.glow} strokeWidth="3" opacity="0.55" filter={`url(#${id}g)`} />}
      <ellipse className="portal-core" cx="20" cy="26" rx="14" ry="20" fill={`url(#${id}c)`} />
      <g clipPath={`url(#${id}k)`} fill="none" strokeLinecap="round">
        <circle className="portal-swirl" cx="20" cy="27" r="11" stroke={c.core} strokeOpacity="0.55" strokeWidth="1.6" strokeDasharray="14 9 5 12" />
        <circle className="portal-swirl reverse" cx="20" cy="25" r="6.5" stroke={c.core} strokeOpacity="0.7" strokeWidth="1.3" strokeDasharray="8 6 3 8" />
      </g>
      <ellipse cx="20" cy="26" rx="15" ry="21" fill="none" stroke={c.ring} strokeWidth="2.2" />
      {state === 'error' && <path d="M21 5 l-3 9 l5 5 l-4 8 l4 6 l-3 9" fill="none" stroke="#0b0d1a" strokeWidth="2.2" strokeLinejoin="round" />}
    </svg>
  );
}

/** HORAZON with the portal as its O. */
export function Wordmark({ state }: { state: PortalState }) {
  return (
    <span className="inline-flex items-center font-display text-[22px] leading-none font-extrabold tracking-[0.06em] text-text">
      H
      <span className="mx-[1px] -my-2 inline-flex">
        <Portal state={state} size={34} />
      </span>
      RAZON
    </span>
  );
}

/** One rune per section of the rail, drawn in a single stroke (not a font). */
const RUNES: Record<string, string> = {
  session: 'M7 1.5v11M3.5 4.5 7 7.5l3.5-3M3.5 9.5 7 12.5l3.5-3',
  drops: 'M4 1.5v11M4 4l5.5-2.5M4 8l5.5-2.5M10 9.5l-2 3',
  runs: 'M2.5 12.5c4 0 1-5.5 4.5-5.5s.5-5.5 4.5-5.5',
  grail: 'M3.5 2v5a3.5 3.5 0 0 0 7 0V2M7 10.5v2M4.5 12.5h5',
  trade: 'M2.5 1.5l9 11M11.5 1.5l-9 11M7 1.5v11',
  activity: 'M1.5 7.5h2.5l1.5-4 3 8 1.5-4h2.5',
  stream: 'M2 7a5 5 0 0 1 10 0M4.5 7a2.5 2.5 0 0 1 5 0M7 7v5.5',
  setup: 'M7 1.5v11M3 3.5l8 7M11 3.5l-8 7',
};

export function Rune({ name, active }: { name: string; active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden
      className={`shrink-0 transition-[color,filter] ${active ? 'text-accent drop-shadow-[0_0_4px_var(--color-accent)]' : 'text-muted/50 group-hover:text-muted'}`}
    >
      <path d={RUNES[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
