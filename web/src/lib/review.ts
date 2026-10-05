import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchDrops, fetchListings } from './api';
import { useChanges } from './live';
import type { Drop } from './types';

/**
 * Trade review: every drop with its full stats synced (an item id from the stash/character API,
 * so it can be posted) waits here until it is listed on the trade site or stashed.
 * The chime plays when a drop joins, i.e. when its stats arrive.
 */
export interface TradeReview {
  pending: { drop: Drop }[];
  /** Every (non-ignored) drop, all time - shared so other trade views don't refetch. */
  drops: Drop[];
  sound: boolean;
  setSound: (on: boolean) => void;
}

const SOUND_KEY = 'horazon.review.sound';
const NOTIFIED_KEY = 'horazon.review.notified';

const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

let audio: AudioContext | null = null;
/** A short two-note chime (no asset needed). Browsers only allow audio after the page was interacted with. */
export function playChime() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const now = audio.currentTime;
    for (const [i, freq] of [880, 1318.5].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.14;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    }
  } catch {}
}

/**
 * Drops on the trade site, waiting for a decision or sold: they're out of review. One whose listing
 * ended unsold is back in your stash (stashed), and can be reviewed and sold again.
 */
export const listedDrops = (listings: { drop_id: number | null; outcome: string | null }[]) =>
  new Set(listings.flatMap((l) => (l.drop_id === null || l.outcome === 'unsold' ? [] : [String(l.drop_id)])));

/** Magic, rare and crafted items: listed on the Trade tab while they are in your stash. */
export const BLUE_YELLOW = new Set(['Magic', 'Rare', 'Crafted']);

/** Called once in App (next to the values loader), shared through TradeReviewContext. */
export function useTradeReviewLoader(): TradeReview {
  const [sound, setSoundState] = useState(() => load(SOUND_KEY, true));
  const [drops, setDrops] = useState<Drop[]>([]);
  const [listed, setListed] = useState<Set<string>>(new Set());
  const version = useChanges('drops', 'listings');

  useEffect(() => {
    let cancelled = false;
    fetchListings()
      .then(async ({ listings }) => {
        const found = await fetchDrops({ since: null, until: null });
        if (cancelled) return;
        setListed(listedDrops(listings));
        setDrops(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [version]);

  const pending = useMemo(
    () =>
      drops
        // Magic/rare/crafted finds join the Trade list from the stash (stash-finds) without a chime or the rail badge.
        .filter((d) => !d.ignored && !d.stashed_at && !!d.item.id && d.source !== 'sample' && !listed.has(String(d.id)))
        .filter((d) => !BLUE_YELLOW.has(d.item.quality?.name ?? ''))
        .map((drop) => ({ drop })),
    [drops, listed],
  );

  // Chime once per drop, ever: ids already notified are remembered across reloads.
  const notified = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!drops.length) return;
    const ids = pending.map((p) => String(p.drop.id));
    if (notified.current === null) {
      const stored = load<string[] | null>(NOTIFIED_KEY, null);
      notified.current = new Set(stored ?? ids); // first run ever: start quiet
    }
    const fresh = ids.filter((id) => !notified.current!.has(id));
    if (fresh.length && sound) playChime();
    fresh.forEach((id) => notified.current!.add(id));
    save(NOTIFIED_KEY, [...notified.current].slice(-500));
  }, [pending, drops.length, sound]);

  return {
    pending,
    drops,
    sound,
    setSound: (on) => {
      setSoundState(on);
      save(SOUND_KEY, on);
    },
  };
}

export const TradeReviewContext = createContext<TradeReview>({ pending: [], drops: [], sound: true, setSound: () => {} });
export const useTradeReview = () => useContext(TradeReviewContext);
