import portalAnim from '../assets/icons/portal.webp';
import portalStill from '../assets/icons/portal.png';

/** Width over height of the portal sprite. */
const PORTAL_ASPECT = 36 / 62;

export type PortalState = 'live' | 'idle' | 'error';

/** Idle is the still portal dimmed; error is it turned red. */
const LOOK: Record<PortalState, string> = {
  live: '',
  idle: 'opacity-60 saturate-[.3] brightness-75',
  error: 'hue-rotate-[145deg] saturate-150',
};

/**
 * Horazon's portal (a SpriteCook pixel-art loop, see web/src/assets/icons/README.md): the O of the
 * wordmark and the app's status light. It swirls while the capture is live, sits dim and still when
 * idle, and burns red when a source is failing. Reduced motion gets the still frame.
 */
export function Portal({ state, size = 28, title }: { state: PortalState; size?: number; title?: string }) {
  return (
    <picture className="portal inline-flex shrink-0" data-state={state}>
      {state === 'live' && <source media="(prefers-reduced-motion: reduce)" srcSet={portalStill} />}
      <img
        src={state === 'live' ? portalAnim : portalStill}
        width={Math.round(size * PORTAL_ASPECT)}
        height={size}
        alt={title ?? ''}
        title={title}
        draggable={false}
        className={LOOK[state]}
      />
    </picture>
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
