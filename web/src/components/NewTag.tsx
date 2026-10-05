/** The "new for the grail" mark, in the app and the overlays alike: a parchment-gold sparkle. */
export function NewMark({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={`inline-block shrink-0 text-grail ${className}`} role="img" aria-label="New for the grail">
      <title>First time found - new for the grail</title>
      <path d="M8 .5c.6 3.9 3.6 6.9 7.5 7.5-3.9.6-6.9 3.6-7.5 7.5C7.4 11.6 4.4 8.6.5 8 4.4 7.4 7.4 4.4 8 .5z" fill="currentColor" />
    </svg>
  );
}
