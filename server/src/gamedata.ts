import { existsSync, readFileSync } from 'node:fs';

/**
 * Item names from web/src/data/game-data.json (scripts/extract_game_data.py), for
 * naming items seen by the capture before the PD2 API reports them, area names
 * (web/src/data/areas.json) for reading corruption notices, and the currency list
 * (web/src/data/currency.json) for which drops are kept. The desktop package copies them
 * next to the compiled server.
 */
type Base = { name: string | null; type: string | null; w: number; h: number; img?: string };
type Named = { id?: number; base: string; img?: string };
interface GameData {
  bases: Record<string, Base>;
  uniques: Record<string, Named>;
  sets: Record<string, Named>;
}

function load<T>(name: string, fallback: T): T {
  const file = [new URL(`./data/${name}`, import.meta.url), new URL(`../../web/src/data/${name}`, import.meta.url)].find((u) => existsSync(u));
  if (!file) console.warn(`${name} not found`);
  return file ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
}
const data = load<GameData>('game-data.json', { bases: {}, uniques: {}, sets: {} });
/** Diablo II levels.txt names by area id (web/src/data/areas.json). */
const areaNames = load<string[]>('areas.json', []);
/** Valuable currency and shards (web/src/data/currency.json, shared with the UI). */
const currency = load<{ valuable: Record<string, string>; shards: Record<string, string> }>('currency.json', { valuable: {}, shards: {} });
const KEPT_CODES = new Set([...Object.keys(currency.valuable), ...Object.keys(currency.shards)]);

/**
 * Which finds become drop rows: uniques and sets (grail), runes and valuable currency /
 * shards. Magic, rare and crafted items, gems, bases and maps aren't recorded - ground
 * drops of every quality are still counted per area.
 */
export function isKeptDrop(code: string, quality: string | undefined): boolean {
  const q = quality?.toLowerCase();
  return q === 'unique' || q === 'set' || /^r\d\ds?$/.test(code) || KEPT_CODES.has(code);
}

/**
 * Every item image the UI can show (web/src/lib/itemImage.ts): bases, uniques and sets,
 * and the ring, amulet, jewel and charm variants picked by graphic id.
 */
export function itemImageNames(): string[] {
  const names = new Set<string>();
  for (const table of [data.bases, data.uniques, data.sets] as Record<string, { img?: string }>[]) {
    for (const entry of Object.values(table)) if (entry.img) names.add(entry.img);
  }
  // Base art + 1-based graphic id (rings, amulets, jewels); charms are invch1-9 whatever the size.
  const variants: [string | undefined, number][] = [[data.bases.rin?.img, 5], [data.bases.amu?.img, 3], [data.bases.jew?.img, 6], ['invch', 9]];
  for (const [file, count] of variants) if (file) for (let i = 1; i <= count; i++) names.add(`${file}${i}`);
  return [...names];
}

const byId = (table: Record<string, Named>) => new Map(Object.entries(table).map(([name, e]) => [e.id, { name, base: e.base }]));
const uniqueById = byId(data.uniques);
const setById = byId(data.sets);
/** Base code -> the one unique/set on it, for bases with a single one. */
const onlyOnBase = (table: Record<string, Named>) => {
  const counts = new Map<string, number>();
  for (const e of Object.values(table)) counts.set(e.base, (counts.get(e.base) ?? 0) + 1);
  return new Map(Object.entries(table).filter(([, e]) => counts.get(e.base) === 1).map(([name, e]) => [e.base, name]));
};
const uniqueOnBase = onlyOnBase(data.uniques);
const setOnBase = onlyOnBase(data.sets);

export const baseInfo = (code: string): Base | undefined => data.bases[code];

/** Unique maps each have their own base (t51-t58), named only "Map": base code -> the unique's name. */
const uniqueMaps = new Map(
  Object.entries(data.uniques)
    .filter(([, u]) => data.bases[u.base]?.type === 'Map T5')
    .map(([name, u]) => [u.base, name]),
);
export const uniqueMapName = (code: string) => uniqueMaps.get(code) ?? null;

/** Zone names in PD2's wording that differ from levels.txt. */
const AREA_ALIASES: Record<string, number[]> = {
  'secret cow level': [39],
  'lut gholein sewers': [47, 48, 49],
  'palace cellars': [52, 53, 54],
};

/**
 * Area ids for a zone name as the game words it in notices: "the Flayer Dungeon" ->
 * every Flayer Dungeon level, "Tal Rasha's Tomb" -> all seven tombs.
 */
export function areasNamed(name: string): number[] {
  const want = name.replace(/^the\s+/i, '').trim().toLowerCase();
  if (AREA_ALIASES[want]) return AREA_ALIASES[want];
  const ids: number[] = [];
  areaNames.forEach((n, id) => {
    if (n && n.replace(/ Level \d+$/, '').toLowerCase() === want) ids.push(id);
  });
  return ids;
}

/**
 * Name of an identified unique/set from its in-game index. The site's ids run one
 * ahead of the game's for part of the table, so neighbours are checked and the one
 * whose base matches the item wins, else the only unique/set on that base.
 */
export function setOrUniqueName(code: string, quality: string | undefined, uid: number | undefined): string | null {
  if (uid === undefined || (quality !== 'unique' && quality !== 'set')) return null;
  const table = quality === 'unique' ? uniqueById : setById;
  for (const id of [uid, uid + 1, uid - 1, uid + 2]) {
    const hit = table.get(id);
    if (hit && hit.base === code) return hit.name;
  }
  // The site lists some items once that the game has several rows for (each Rainbow Facet): the
  // only one on its base is it.
  return (quality === 'unique' ? uniqueOnBase : setOnBase).get(code) ?? null;
}
