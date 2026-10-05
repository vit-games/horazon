import gameData from '../data/game-data.json';
import type { GrailFound } from './api';
import { CATALOG } from './grail';
import type { Drop, Item } from './types';

/**
 * Made-up drops and grail progress for the overlay previews on the Stream tab (`?sample=1`), so a new
 * install sees what each overlay looks like before it has any data of its own. Built from the game's
 * real item data, so art, tiers and ranking work exactly as they do on live drops.
 */
const bases = gameData.bases as Record<string, { name: string | null; w: number; h: number; type?: string }>;

export function sampleItem(name: string, quality: 'Unique' | 'Set' | 'Normal', code: string, extra: Partial<Item> = {}): Item {
  const base = bases[code];
  return {
    id: 0,
    name,
    base_code: code,
    quality: { id: 0, name: quality },
    base: {
      id: code,
      name: base?.name ?? code,
      category: '',
      type: base?.type ?? '',
      type_code: /^r\d\d$/.test(code) ? 'rune' : '',
      size: { width: base?.w ?? 1, height: base?.h ?? 1 },
    },
    is_identified: true,
    is_ethereal: false,
    is_simple: quality === 'Normal',
    is_runeword: false,
    corrupted: false,
    socket_count: 0,
    graphic_id: null,
    modifiers: [],
    ...extra,
  };
}

const HOUR = 3600e3;

/** Today (from the overlay's day start) and the two days before, newest first. */
export function sampleDrops(today: number): Drop[] {
  let id = -100;
  const drop = (hoursIn: number, item: Item, quantity = 1, character = 'Vitsin'): Drop => ({
    id: id--,
    found_at: new Date(today + hoursIn * HOUR).toISOString(),
    character,
    quantity,
    item,
    source: 'sample',
  });
  const day = (n: number) => -24 * n;
  return [
    drop(3.2, sampleItem('Harlequin Crest', 'Unique', 'uap', { corrupted: true, socket_count: 1 })),
    drop(2.6, sampleItem('Ber Rune', 'Normal', 'r30')),
    drop(2.1, sampleItem("Griffon's Eye", 'Unique', 'ci3')),
    drop(1.4, sampleItem("Tal Rasha's Guardianship", 'Set', 'uth')),
    drop(1.1, sampleItem('Ist Rune', 'Normal', 'r24'), 2),
    drop(0.8, sampleItem('Key of Destruction', 'Normal', 'pk3'), 3),
    drop(0.5, sampleItem('Worldstone Shard', 'Normal', 'wss'), 4),
    drop(day(1) + 4.5, sampleItem('The Stone of Jordan', 'Unique', 'rin')),
    drop(day(1) + 3, sampleItem("Death's Web", 'Unique', '7gw')),
    drop(day(1) + 2, sampleItem("Mephisto's Brain", 'Normal', 'mbr')),
    drop(day(2) + 5, sampleItem("Tal Rasha's Horadric Crest", 'Set', 'xsh')),
  ];
}

/** Grail progress partway through a season: 212 uniques and 58 sets, two of today's drops new for it. */
export function sampleGrail(drops: Drop[]): GrailFound[] {
  const firstFinds = new Map(drops.filter((d) => d.item.name === "Griffon's Eye" || d.item.name === "Tal Rasha's Guardianship").map((d) => [d.item.name, d]));
  const pick = (quality: 'Unique' | 'Set', n: number) => CATALOG.filter((e) => e.quality === quality && !firstFinds.has(e.name)).slice(0, n);
  const found = [...pick('Unique', 211), ...pick('Set', 57)].map(
    (e): GrailFound => ({ quality: e.quality as 'Unique' | 'Set', name: e.name, found_at: new Date(0).toISOString(), baseline: true, drop_id: null, item: sampleItem(e.name, e.quality as 'Unique' | 'Set', e.base_code) }),
  );
  for (const d of firstFinds.values()) {
    found.push({ quality: d.item.quality.name as 'Unique' | 'Set', name: d.item.name, found_at: d.found_at, baseline: false, drop_id: d.id, item: d.item });
  }
  return found;
}
