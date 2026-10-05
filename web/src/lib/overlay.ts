import { useEffect } from 'react';

/** Marks the page as an overlay: transparent, no scrollbars (index.css, html.overlay-mode). */
export function useOverlayPage() {
  useEffect(() => {
    document.documentElement.classList.add('overlay-mode');
    return () => document.documentElement.classList.remove('overlay-mode');
  }, []);
}

const clampNum = (v: string | null, lo: number, hi: number, fallback: number) => {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** `scale` from an overlay URL: a size multiplier for Browser Sources (0.5-3, default 1). */
export const overlayScale = (p: URLSearchParams) => clampNum(p.get('scale'), 0.5, 3, 1);
