import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchDrops, fetchGrail, fetchSeasons, type GrailFound, type Season } from './api';
import { useChanges } from './live';
import { isCurrency, stackCurrency, WORLDSTONE_CODES, type CurrencyStack } from './currencyDrops';
import { VALUABLE_CODES, itemGroup } from './itemStyle';
import { runeNumber } from './runes';
import { tierOf, type TierInfo } from './tiers';
import { rankScore } from './rank';
import { sampleDrops, sampleGrail } from './sampleOverlay';
import { useValues } from './values';
import type { Drop } from './types';

/**
 * What the drop overlays list (unchanged, so existing OBS URLs render as before): tiered items,
 * uniques, sets, runes at/above `minRune`. The app's own "notable" is `isNotable` in rank.ts.
 */
function overlayWorthy(d: Drop, minRune: number, tier: TierInfo | null): boolean {
  if (tier) return true;
  const g = itemGroup(d.item);
  if (g === 'Unique' || g === 'Set') return true;
  const rune = runeNumber(d.item);
  return rune !== null && rune >= minRune;
}

const DAY = 24 * 3600e3;

/** Start of the "gaming day" containing t (days begin at dayStart o'clock, local time). */
export function dayStartOf(t: number, dayStart: number): number {
  const d = new Date(t - dayStart * 3600e3);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + dayStart * 3600e3;
}

/** Current time, re-read every minute so day boundaries roll over without a reload. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export interface FeedOptions {
  days: number;
  count: number;
  min: number;
  dayStart: number;
  character: string;
  onlyTiered: boolean;
  grail: 'all' | 'season' | 'off';
  /** Made-up drops and grail progress instead of live data (the Stream tab's previews). */
  sample?: boolean;
}

export interface FeedDay {
  start: number;
  /** The day's best items (not currency), up to `count`. */
  top: Drop[];
  /** The day's currency, one stack per kind (Worldstone Shards apart, see `shards`). */
  currency: CurrencyStack[];
  /** Worldstone / Tainted Worldstone Shards picked up that day. */
  shards: CurrencyStack[];
  count: number;
}

/**
 * Live data behind the overlays: each day's top drops (ranked the same
 * way everywhere), grail finds in scope, and which drop ids just arrived (for animation).
 */
export function useLiveDrops(options: FeedOptions) {
  const values = useValues();
  const now = useNow();
  const version = useChanges('drops');
  const [drops, setDrops] = useState<Drop[]>([]);
  const [grail, setGrail] = useState<GrailFound[] | null>(null);
  const [season, setSeason] = useState<Season | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const known = useRef<Set<number> | null>(null);

  const today = dayStartOf(now, options.dayStart);
  const since = today - (options.days - 1) * DAY;

  useEffect(() => {
    if (options.grail !== 'season') return;
    fetchSeasons().then((all) => setSeason(all.find((s) => !s.end) ?? null), () => {});
  }, [options.grail]);

  // The previews: made-up drops and grail, nothing fetched.
  useEffect(() => {
    if (!options.sample) return;
    const list = sampleDrops(today);
    setDrops(list);
    setGrail(sampleGrail(list));
  }, [options.sample, today]);

  useEffect(() => {
    if (options.sample || options.grail === 'off' || (options.grail === 'season' && !season)) return;
    fetchGrail({ since: season ? new Date(season.start) : null, until: null }).then(setGrail, () => {});
  }, [options.grail, options.sample, season, version]);

  // Only drops that arrive while the page is open count as fresh (not the first load).
  useEffect(() => {
    if (options.sample) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetchDrops({ since: new Date(since), until: null }).then((list) => {
      const ids = list.map((d) => d.id);
      if (known.current) {
        const added = ids.filter((id) => !known.current!.has(id));
        if (added.length) {
          setFresh(new Set(added));
          timer = setTimeout(() => setFresh(new Set()), 8000);
        }
      }
      known.current = new Set([...(known.current ?? []), ...ids]);
      setDrops(list);
    }, () => {});
    return () => clearTimeout(timer);
  }, [since, version, options.sample]);

  const newFinds = useMemo(() => new Set((grail ?? []).flatMap((g) => (g.drop_id === null ? [] : [g.drop_id]))), [grail]);
  const tiers = useMemo(() => new Map<number, TierInfo | null>(drops.map((d) => [d.id, tierOf(d.item, values)])), [drops, values]);

  const days: FeedDay[] = useMemo(() => {
    const out: FeedDay[] = [];
    for (let i = 0; i < options.days; i++) {
      const start = today - i * DAY;
      const ofDay = drops.filter((d) => {
        const t = new Date(d.found_at).getTime();
        return t >= start && t < start + DAY && (!options.character || d.character === options.character);
      });
      const tierOfDrop = (d: Drop) => tiers.get(d.id) ?? null;
      // Items: the notable ones. Currency: tiered, runes from `min`, the valuable currency (keys,
      // organs, essences...) - gems and low runes only when tiered.
      const list = ofDay.filter((d) => !isCurrency(d.item) && (options.onlyTiered ? tierOfDrop(d) !== null : overlayWorthy(d, options.min, tierOfDrop(d))));
      const currencyDrops = ofDay.filter((d) => {
        if (!isCurrency(d.item) || WORLDSTONE_CODES.has(d.item.base_code)) return false;
        if (tierOfDrop(d) !== null) return true;
        if (options.onlyTiered) return false;
        const rune = /^r(\d\d)s?$/.exec(d.item.base_code);
        return rune ? Number(rune[1]) >= options.min : VALUABLE_CODES.has(d.item.base_code) || d.item.base_code === 'iwss';
      });
      const currency = stackCurrency(currencyDrops, tierOfDrop);
      const shards = stackCurrency(
        ofDay.filter((d) => WORLDSTONE_CODES.has(d.item.base_code)),
        () => null,
      );
      const top = [...list]
        .sort(
          (a, b) =>
            rankScore(b, newFinds, tiers.get(b.id) ?? null) - rankScore(a, newFinds, tiers.get(a.id) ?? null) ||
            b.found_at.localeCompare(a.found_at),
        )
        .slice(0, options.count);
      out.push({ start, top, currency, shards, count: list.length + currencyDrops.length }); // drops, not stack units: "5 notable" over rows and a currency line
    }
    return out;
  }, [drops, today, options, newFinds, tiers]);

  return { days, drops, grail, season, newFinds, tiers, fresh, today };
}
