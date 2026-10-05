import type React from 'react';
import defaultTiers from '../data/default-tiers.json';
import gameData from '../data/game-data.json';
import type { Item } from './types';
import type { ValuesData } from './values';

/**
 * Item tiers: the user's own ranking of notable drops (Settings are on the server, so the app,
 * the browser and OBS overlays share them). Tiers are listed best first; an item counts in the
 * best tier holding it.
 */

/**
 * One tiered item: a unique or set by name, or any item by base code (runes, keys, ubers...).
 * `eth`: true = ethereal only, false = non-ethereal only, absent = either.
 */
export interface TierEntry {
  kind: 'unique' | 'set' | 'base';
  key: string;
  eth?: boolean;
}
export interface Tier {
  id: string;
  name: string;
  /** #rrggbb, or null for the default ramp colour of its position. */
  color: string | null;
  entries: TierEntry[];
}
export interface TierConfig {
  tiers: Tier[];
}

/** "Tier 2 · Mirror / Vial": the stripe's meaning in words (rank 0 is tier 1, the best). */
export const tierLabel = (t: { rank: number; name: string }) => `Tier ${t.rank + 1} · ${t.name}`;

/** A drop's tier: its rank (0 = best), name and colour. */
export interface TierInfo {
  rank: number;
  name: string;
  color: string;
}

const uniqueBase = new Map(Object.entries(gameData.uniques as Record<string, { base: string }>).map(([name, u]) => [name, u.base]));

/** The built-in default (data/default-tiers.json), used until the user saves their own. */
export const DEFAULT_TIERS: TierConfig = defaultTiers as TierConfig;

/** The tiers in effect: the user's, or the default. */
export const tiersOf = (values: ValuesData): TierConfig => values.tiers ?? DEFAULT_TIERS;

// Ramp from pale gold (lowest tier) through amber and fire orange to blood red (best).
const RAMP = ['#ffe08a', '#ffb13b', '#ff6a2b', '#e3122d'];
function rampAt(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const k = x - i;
  const [a, b] = [RAMP[i], RAMP[i + 1]].map((c) => [1, 3, 5].map((o) => parseInt(c.slice(o, o + 2), 16)));
  return `#${a.map((v, j) => Math.round(v + (b[j] - v) * k).toString(16).padStart(2, '0')).join('')}`;
}
/** A tier's colour: its own, or its place on the ramp (best = red, lowest = pale gold). */
export const tierColor = (config: TierConfig, rank: number): string =>
  config.tiers[rank]?.color ?? rampAt(config.tiers.length > 1 ? 1 - rank / (config.tiers.length - 1) : 1);

/** Boss-only uniques on a base that ordinary uniques also drop on. */
const BOSS_ONLY = new Set(["Overlord's Helm"]);

/** Matching index per config: entry key -> the best (rank, eth) holding it. */
type Index = Map<string, { rank: number; eth?: boolean }[]>;
const indexes = new WeakMap<TierConfig, Index>();
function indexOf(config: TierConfig): Index {
  let index = indexes.get(config);
  if (!index) {
    index = new Map();
    config.tiers.forEach((tier, rank) => {
      for (const e of tier.entries) {
        const k = `${e.kind}:${e.key}`;
        index!.set(k, [...(index!.get(k) ?? []), { rank, eth: e.eth }]);
        // An unidentified unique only shows its base: it may be any unique on it
        // (but never a boss-only one: an unidentified Bone Visage is a Giant Skull).
        if (e.kind === 'unique' && !BOSS_ONLY.has(e.key)) {
          const b = `unid:${uniqueBase.get(e.key)}`;
          index!.set(b, [...(index!.get(b) ?? []), { rank, eth: e.eth }]);
        }
      }
    });
    indexes.set(config, index);
  }
  return index;
}

/** The best tier holding this item, or null. */
export function tierOf(item: Item, values: ValuesData): TierInfo | null {
  const config = tiersOf(values);
  const index = indexOf(config);
  const quality = item.quality?.name;
  const keys = [`base:${item.base_code.replace(/^(r\d\d)s$/, '$1')}`]; // stacked runes count as runes
  if (quality === 'Unique') keys.push(item.is_identified === false ? `unid:${item.base_code}` : `unique:${item.name}`);
  if (quality === 'Set') keys.push(`set:${item.name}`);
  let best: number | null = null;
  for (const k of keys) {
    for (const hit of index.get(k) ?? []) {
      if (hit.eth !== undefined && hit.eth !== !!item.is_ethereal) continue;
      if (best === null || hit.rank < best) best = hit.rank;
    }
  }
  return best === null ? null : { rank: best, name: config.tiers[best].name, color: tierColor(config, best) };
}

/** Inline style setting `--tier` for the .tier-row / .tier-card / .tier-glow classes. */
export const tierStyle = (tier: TierInfo | null): React.CSSProperties | undefined =>
  tier ? ({ '--tier': tier.color } as React.CSSProperties) : undefined;

export async function saveTiers(config: TierConfig | null) {
  const res = await fetch('/api/tiers', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tiers: config }) });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `saving tiers failed: ${res.status}`);
}

/** Shared tier lists are JSON files in this format; ids are left out (an import gets new ones). */
const TIER_FILE = 'horazon-tiers';

export function tierFile(config: TierConfig): string {
  const tiers = config.tiers.map(({ name, color, entries }) => ({ name, color, entries }));
  return JSON.stringify({ format: TIER_FILE, version: 1, tiers }, null, 2);
}

/** A tier list from a shared file (or a bare {tiers}), checked as the server will; throws why not. */
export function parseTierFile(text: string): TierConfig {
  let data: { format?: unknown; tiers?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a tier file: it is not JSON.');
  }
  if (data?.format !== undefined && data.format !== TIER_FILE) throw new Error('Not a tier file.');
  const tiers = data?.tiers;
  if (!Array.isArray(tiers) || !tiers.length) throw new Error('Not a tier file: it has no tiers.');
  if (tiers.length > 30) throw new Error('Too many tiers (30 at most).');
  return {
    tiers: tiers.map((t: Record<string, unknown>, i) => {
      if (!t || !Array.isArray(t.entries) || t.entries.length > 3000) throw new Error(`Tier ${i + 1} is malformed.`);
      const entries = (t.entries as Record<string, unknown>[]).map((e) => {
        if (!e || !['unique', 'set', 'base'].includes(e.kind as string) || typeof e.key !== 'string' || !e.key || e.key.length > 80)
          throw new Error(`Tier ${i + 1} has a malformed item.`);
        return { kind: e.kind as TierEntry['kind'], key: e.key, ...(typeof e.eth === 'boolean' ? { eth: e.eth } : {}) };
      });
      const name = typeof t.name === 'string' ? t.name.trim().slice(0, 40) : '';
      const color = typeof t.color === 'string' && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color.toLowerCase() : null;
      return { id: `t${Date.now().toString(36)}${i}`, name: name || `Tier ${i + 1}`, color, entries };
    }),
  };
}
