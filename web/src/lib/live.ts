import { useEffect, useState } from 'react';

export type ChangeKind = 'drops' | 'stats' | 'sources' | 'values' | 'runs' | 'listings' | 'live';

type Listener = (kind: ChangeKind) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

type Subscribe = (l: Listener) => () => void;
declare global {
  interface Window {
    /** The page's change stream, shared with same-origin frames (the Stream tab's previews). */
    __horazonChanges?: Subscribe;
  }
}

/**
 * One change stream per window. A preview framed by the app listens to the app's stream instead of
 * opening its own: browsers allow six connections per host, and five previews plus the app would
 * use them all, stalling every request after. An overlay in OBS (no parent) opens its own.
 */
function connect() {
  if (source) return;
  try {
    const shared = window.parent !== window ? window.parent.__horazonChanges : undefined;
    if (shared) {
      source = {} as EventSource;
      const off = shared((kind) => listeners.forEach((l) => l(kind)));
      // A reloaded or removed preview leaves the app's stream.
      window.addEventListener('pagehide', off);
      return;
    }
  } catch {
    // a cross-origin parent: open our own
  }
  source = new EventSource('/api/events');
  source.onmessage = (e) =>
    listeners.forEach((l) => {
      try {
        l(e.data as ChangeKind);
      } catch {
        listeners.delete(l); // a frame that went away without saying so
      }
    });
  window.__horazonChanges = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
}

/**
 * A counter that bumps (debounced) whenever the server reports a change of one of
 * `kinds`. Use it as an effect dependency to refetch live.
 */
export function useChanges(...kinds: ChangeKind[]): number {
  const [version, setVersion] = useState(0);
  const key = kinds.join(',');
  useEffect(() => {
    connect();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wanted = new Set(key.split(','));
    const listener: Listener = (kind) => {
      if (!wanted.has(kind)) return;
      clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 400);
    };
    listeners.add(listener);
    return () => {
      clearTimeout(timer);
      listeners.delete(listener);
    };
  }, [key]);
  return version;
}
