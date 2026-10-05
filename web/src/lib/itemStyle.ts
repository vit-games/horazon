import currency from '../data/currency.json';
import { runeNumber, runeTier } from './runes';
import type { Item } from './types';

/**
 * High-value currency (base codes), listed with uniques and runes in the drop and run
 * lists: the rare uber drops (Puzzlebox, Skeleton Key, Demonic Cube, Vial of Lightsong,
 * Lilith's Mirror) plus uber keys, organs, essences and materials. Shared
 * with the server (which only records these, uniques, sets and runes): data/currency.json.
 */
export const VALUABLE_CODES = new Set(Object.keys(currency.valuable));

/** Currency counted on Drops → Currency: the valuable items plus Worldstone/Tainted/Catalyst Shards. */
export const CURRENCY_CODES = new Set([...VALUABLE_CODES, ...Object.keys(currency.shards)]);

/**
 * Filter/summary buckets. Runes are split by tier, gems and valuable currency get
 * their own groups, plain (normal/superior) bases collapse into "Base".
 */
export const GROUPS = ['Unique', 'Set', 'HighRune', 'MidRune', 'LowRune', 'Currency', 'Rare', 'Crafted', 'Magic', 'Gem', 'Base'] as const;
export type Group = (typeof GROUPS)[number];

export function itemGroup(item: Item): Group {
  const rune = runeNumber(item);
  if (rune !== null) return `${runeTier(rune)}Rune`;
  if (item.base?.type === 'Gem') return 'Gem';
  if (VALUABLE_CODES.has(item.base_code)) return 'Currency';
  const q = item.quality?.name;
  if (q === 'Unique' || q === 'Set' || q === 'Rare' || q === 'Crafted' || q === 'Magic') return q;
  return 'Base';
}

/** In-game text color class for an item's name. */
export function nameColor(item: Item): string {
  if (item.is_runeword) return 'text-q-unique';
  switch (itemGroup(item)) {
    case 'Unique': return 'text-q-unique';
    case 'Set': return 'text-q-set';
    case 'Rare': return 'text-q-rare';
    case 'Crafted':
    case 'HighRune':
    case 'MidRune':
    case 'LowRune': return 'text-q-crafted';
    case 'Magic': return 'text-q-magic';
    default:
      return item.is_ethereal || item.socket_count > 0 ? 'text-q-gray' : 'text-q-normal';
  }
}

export const GROUP_COLOR: Record<Group, string> = {
  Unique: 'text-q-unique',
  Set: 'text-q-set',
  HighRune: 'text-q-crafted',
  MidRune: 'text-q-crafted',
  LowRune: 'text-q-crafted',
  Currency: 'text-q-normal',
  Rare: 'text-q-rare',
  Crafted: 'text-q-crafted',
  Magic: 'text-q-magic',
  Gem: 'text-q-normal',
  Base: 'text-q-gray',
};

export const GROUP_LABEL: Record<Group, string> = {
  Unique: 'Uniques',
  Set: 'Sets',
  HighRune: 'High runes',
  MidRune: 'Mid runes',
  LowRune: 'Low runes',
  Currency: 'Currency',
  Rare: 'Rares',
  Crafted: 'Crafted',
  Magic: 'Magic',
  Gem: 'Gems',
  Base: 'Bases',
};

const KIND_NAMES: Record<string, string> = { UberUnique: 'Uber item', ImbueRandom: 'Crafting item' };

/**
 * Short description under an item's name: "Unique Shako", "Magic Grand Charm", or for
 * plain misc items whose name is their base ("Vial of Lightsong") just the kind.
 */
export function itemKind(item: Item): string {
  const q = item.quality?.name ?? '';
  const base = item.base;
  if (!base) return q;
  if (item.name === base.name && (q === 'Normal' || q === '')) return KIND_NAMES[base.type] ?? base.type ?? '';
  const baseLabel = item.name === base.name || itemGroup(item) === 'Magic' ? base.type : base.name;
  return `${q} ${baseLabel}`;
}

const CLASSES = ['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian', 'Druid', 'Assassin'];
/**
 * A Hellfire Torch's rolls: its class (and skill levels), Vitality, Energy, All Resistances and
 * Light Radius (uniqueitems.txt: vit 30-60, enr 10-20, res-all 10-20, light 4-8); null if
 * unidentified or not a Torch.
 */
export function torchRoll(item: Item) {
  if (item.name !== 'Hellfire Torch') return null;
  const value = (stat: string) => item.modifiers.find((m) => m.name === stat)?.values[0] ?? null;
  const skills = item.modifiers.find((m) => m.name === 'item_addclassskills');
  const cls = CLASSES.find((c) => skills?.label.includes(c)) ?? null;
  const [vit, ene, res, light] = ['vitality', 'energy', 'all_resist', 'item_lightradius'].map(value);
  if (!cls && vit === null) return null;
  const parts = [vit !== null && `+${vit} Vitality`, ene !== null && `+${ene} Energy`, res !== null && `+${res}% All Res`, light !== null && `+${light} Light Radius`];
  return {
    cls,
    skills: skills?.values[0] ?? null,
    vit,
    ene,
    res,
    light,
    title: [skills?.label, ...parts].filter(Boolean).join(', '),
  };
}

const ELEMENTS: Record<string, string> = { fire: 'Fire', cold: 'Cold', ltng: 'Lightning', pois: 'Poison' };
/** A Rainbow Facet's element and rolls (+dmg% damage, -pierce% enemy resistance); null if unidentified or not a facet. */
export function facetRoll(item: Item) {
  if (item.name !== 'Rainbow Facet') return null;
  for (const [el, label] of Object.entries(ELEMENTS)) {
    const pierce = item.modifiers.find((m) => m.name === `passive_${el}_pierce`)?.values[0];
    if (pierce === undefined) continue;
    const dmg = item.modifiers.find((m) => m.name === `passive_${el}_mastery`)?.values[0] ?? 0;
    return { label, dmg, pierce, color: `var(--color-el-${el})`, title: `+${dmg}% ${label} damage, -${pierce}% enemy ${label} resistance` };
  }
  return null;
}
