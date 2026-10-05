import gameData from '../data/game-data.json';
import type { Item } from './types';
// The server's list of images projectdiablo2.com has no art for (scripts/fetch-item-images.mts).
import noArt from '../../../server/src/assets/items/missing.json';

const NO_ART = new Set<string>(noArt);

type Entry = { img: string; tint?: string };
const bases = gameData.bases as Record<string, Entry & { name: string | null; w: number; h: number }>;
const uniques = gameData.uniques as Record<string, Entry>;
const sets = gameData.sets as Record<string, Entry>;

const CHARMS = ['cm1', 'cm2', 'cm3', 'cm1p', 'cm2p', 'cm3p'];

/**
 * Resolve an item's inventory image the way projectdiablo2.com does
 * (GameArmoryItemImage): identified uniques/sets use their own art, everything
 * else uses the base; graphic_id selects ring/amulet/jewel/charm variants. `fallback`
 * is the base's art, for uniques/sets the site has no art for (Fallen Gardens...).
 */
export function itemImage(item: Item): { src: string; tint?: string; fallback?: string } | null {
  const quality = item.quality?.name;
  let entry: Entry | undefined;
  if (quality === 'Unique' && item.is_identified) entry = uniques[item.name];
  else if (quality === 'Set' && item.is_identified) entry = sets[item.name];
  entry ??= bases[item.base_code];
  if (!entry?.img) return null;

  let file = entry.img;
  // A jewel without a graphic (captured before it was read) gets the first jewel art: the base's is a diamond.
  const gid = item.graphic_id ?? (item.base_code === 'jew' ? 0 : null);
  if (CHARMS.includes(item.base_code)) {
    if (!item.is_identified || quality !== 'Unique' || ['cm3', 'cm3p'].includes(item.base_code)) {
      file = `invch${CHARMS.indexOf(item.base_code) + 1 + 3 * Number(gid || 0)}`;
    }
  } else if (gid === false || gid == null) {
    if (item.modifiers?.some((m) => m.name === 'item_shiny_appearance')) file = `${file}_se`;
  } else {
    file = `${file}${Number(gid) + 1}`;
  }

  const base = bases[item.base_code]?.img;
  const fallback = base && base !== file ? `/pd2/image/items/${base}.png` : undefined;
  // Art the site doesn't have goes straight to the base's, without two failing requests first.
  if (NO_ART.has(file) && fallback) return { src: fallback, tint: entry.tint };
  return { src: `/pd2/image/items/${file}.png`, tint: entry.tint, fallback };
}

/** Inventory size in cells, preferring the API's base size. */
export function itemSize(item: Item): { w: number; h: number } {
  const size = item.base?.size;
  if (size) return { w: size.width, h: size.height };
  const base = bases[item.base_code];
  return { w: base?.w ?? 1, h: base?.h ?? 1 };
}
