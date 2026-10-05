import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Viewport coordinates of the hovered thing: horizontal centre, top and bottom edges. */
export interface Anchor {
  x: number;
  top: number;
  bottom: number;
}

/**
 * A hover card rendered into <body> with fixed positioning, so scrollable or clipped
 * containers can't cut it off. Centred under the anchor, kept inside the window and
 * flipped above it when there's no room below.
 */
export function Floating({ anchor, width = 288, children }: { anchor: Anchor; width?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { height } = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, anchor.x - width / 2), window.innerWidth - width - margin);
    let top = anchor.bottom + 6;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, anchor.top - 6 - height);
    setPos({ left, top });
  }, [anchor, width, children]);

  return createPortal(
    <div
      ref={ref}
      className="pointer-events-none fixed z-50 rounded-sm border border-line bg-panel-hi px-3 py-2 text-xs shadow-[0_8px_24px_rgb(0_0_0/0.5)]"
      style={{ width, ...(pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' }) }}
    >
      {children}
    </div>,
    document.body,
  );
}
