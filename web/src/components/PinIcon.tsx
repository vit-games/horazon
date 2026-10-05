/** A pushpin, filled when pinned. */
export function PinIcon({ filled = false, size = 14 }: { filled?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className="inline-block shrink-0" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M10.5 1.75l3.75 3.75-1.5.5-2.5 2.5.25 3-1.5 1.5L2.5 6.5 4 5l3 .25 2.5-2.5z" />
      <path d="M5.25 10.75L1.75 14.25" fill="none" />
    </svg>
  );
}
