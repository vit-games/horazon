import gameData from '../data/game-data.json';
import type { Item } from './types';

type Base = { name: string | null; type: string | null; w: number; h: number };
export const bases = gameData.bases as Record<string, Base>;

export interface Entry {
  quality: 'Unique' | 'Set';
  name: string;
  base_code: string;
  group: string;
}

// Slot order for uniques; anything else (weapon classes, maps, ...) follows alphabetically.
/**
 * Unique groups under the names players use, clustered and in index order. Each label lists the
 * game-data item types it covers (`bases[code].type`); a type not listed keeps its own name, under Other.
 */
const CLUSTERS: [cluster: string, groups: [label: string, types: string[]][]][] = [
  ['Armour', [['Helms', ['Helm']], ['Circlets', ['Circlet']], ['Body armour', ['Armor']], ['Shields', ['Shield']], ['Gloves', ['Gloves']], ['Belts', ['Belt', 'Belt [S]']], ['Boots', ['Boots']]]],
  ['Jewellery and charms', [['Amulets', ['Amulet', 'Amulet [S]']], ['Rings', ['Ring']], ['Charms and jewels', ['Small Charm', 'Medium Charm', 'Large Charm', 'Grand Charm', 'Jewel']]]],
  [
    'Class items',
    [
      ['Barbarian helms', ['Primal Helm']], ['Druid pelts', ['Pelt']], ['Paladin shields', ['Auric Shields']], ['Necromancer heads', ['Voodoo Heads']],
      ['Sorceress orbs', ['Orb']], ['Assassin claws', ['Hand to Hand', 'Hand to Hand 2']],
      ['Amazon bows', ['Amazon Bow']], ['Amazon javelins', ['Amazon Javelin']], ['Amazon spears', ['Amazon Spear']],
    ],
  ],
  [
    'Weapons',
    [
      ['Axes', ['Axe']], ['Throwing axes', ['Throwing Axe']], ['Bows', ['Bow']], ['Arrow quivers', ['Bow Quiver']], ['Crossbows', ['Crossbow']], ['Bolt quivers', ['Crossbow Quiver']],
      ['Clubs', ['Club']], ['Hammers', ['Hammer']], ['Maces', ['Mace']], ['Scepters', ['Scepter']], ['Daggers', ['Knife']], ['Throwing knives', ['Throwing Knife']],
      ['Javelins', ['Javelin']], ['Spears', ['Spear']], ['Polearms', ['Polearm']], ['Scythes', ['Scythe Type']], ['Staves', ['Staff']], ['Swords', ['Sword']], ['Wands', ['Wand']],
    ],
  ],
  ['Other', [['Unique maps', ['Map T5']]]],
];
const TYPE_LABEL = new Map(CLUSTERS.flatMap(([, groups]) => groups.flatMap(([label, types]) => types.map((t) => [t, label] as const))));
const CLUSTER_OF = new Map(CLUSTERS.flatMap(([cluster, groups]) => groups.map(([label]) => [label, cluster] as const)));
/** Group labels in index order (sets aren't listed: they sort by name). */
export const SLOT_ORDER = CLUSTERS.flatMap(([, groups]) => groups.map(([label]) => label));
/** A unique group's cluster ("Armour", "Weapons", ...); Other for anything unlisted. */
export const clusterOf = (group: string) => CLUSTER_OF.get(group) ?? 'Other';

/** Every obtainable unique/set from the PD2 site data (header rows without a real base are skipped). */
export const CATALOG: Entry[] = [
  ...Object.entries(gameData.uniques as Record<string, { base: string }>)
    .filter(([, u]) => bases[u.base]?.name)
    .map(([name, u]) => ({ quality: 'Unique' as const, name, base_code: u.base, group: TYPE_LABEL.get(bases[u.base].type ?? '') ?? bases[u.base].type ?? 'Other' })),
  ...Object.entries(gameData.sets as Record<string, { base: string; set?: string }>)
    .filter(([, s]) => bases[s.base]?.name)
    .map(([name, s]) => ({ quality: 'Set' as const, name, base_code: s.base, group: s.set ?? 'Other' })),
];

export function pseudoItem(e: Entry): Item {
  const b = bases[e.base_code];
  return {
    id: 0,
    name: e.name,
    base_code: e.base_code,
    quality: { id: e.quality === 'Unique' ? 7 : 5, name: e.quality },
    base: { id: e.base_code, name: b?.name ?? '', category: '', type: b?.type ?? '', type_code: '', size: { width: b?.w ?? 1, height: b?.h ?? 1 } },
    is_identified: true,
    is_ethereal: false,
    is_simple: false,
    is_runeword: false,
    corrupted: false,
    socket_count: 0,
    graphic_id: false,
    modifiers: [],
  };
}

/** Boss-only uniques: a find counts, but they aren't required, so the grail can pass 100%. */
const BOSS_ITEMS = new Set(["Overlord's Helm"]);
// ponytail: Gheed's, Torch, Rainbow Facet and Annihilus still count as required until it's decided.
/** Unique maps are listed but never count. */
const counts = (e: Entry) => e.group !== 'Unique maps';
/** Grail keys ("Unique:Name") of every item a find counts for. */
export const COUNTED_KEYS = new Set(CATALOG.filter(counts).map((e) => `${e.quality}:${e.name}`));
/** Items the grail needs for 100%, per quality. */
export const REQUIRED = {
  Unique: CATALOG.filter((e) => e.quality === 'Unique' && counts(e) && !BOSS_ITEMS.has(e.name)).length,
  Set: CATALOG.filter((e) => e.quality === 'Set' && counts(e)).length,
};

/** Grail progress: counted finds over required items (boss items can take it past 100%). */
export function grailCounts(grail: { quality: 'Unique' | 'Set'; name: string }[]) {
  const found = grail.filter((g) => COUNTED_KEYS.has(`${g.quality}:${g.name}`));
  return {
    Unique: { have: found.filter((g) => g.quality === 'Unique').length, total: REQUIRED.Unique },
    Set: { have: found.filter((g) => g.quality === 'Set').length, total: REQUIRED.Set },
  };
}
