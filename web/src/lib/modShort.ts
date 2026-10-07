import { facetRoll } from './itemStyle';
import type { Item, Modifier } from './types';

/**
 * Item properties in the community's short form ("20% FHR", "+1 Skills", "CBF"), for
 * one-line summaries such as a corruption's outcome. Common stats by name; anything else
 * keeps its value and the initials of its capitalised words ("Half Freeze Duration" -> HFD).
 */
const SHORT: Record<string, (v: number) => string> = {
  item_fastergethitrate: (v) => `${v}% FHR`,
  item_fasterattackrate: (v) => `${v}% IAS`,
  item_fastercastrate: (v) => `${v}% FCR`,
  item_fastermovevelocity: (v) => `${v}% FRW`,
  item_fasterblockrate: (v) => `${v}% FBR`,
  item_magicbonus: (v) => `${v}% MF`,
  item_goldbonus: (v) => `${v}% GF`,
  item_allskills: (v) => `+${v} Skills`,
  maxhp: (v) => `+${v} Life`,
  maxmana: (v) => `+${v} Mana`,
  item_maxhp_percent: (v) => `${v}% Max Life`,
  item_maxmana_percent: (v) => `${v}% Max Mana`,
  strength: (v) => `+${v} Str`,
  dexterity: (v) => `+${v} Dex`,
  vitality: (v) => `+${v} Vit`,
  energy: (v) => `+${v} Ene`,
  all_attributes: (v) => `+${v} All Attr`,
  all_resist: (v) => `${v}% All Res`,
  fireresist: (v) => `${v}% Fire Res`,
  lightresist: (v) => `${v}% Light Res`,
  coldresist: (v) => `${v}% Cold Res`,
  poisonresist: (v) => `${v}% Poison Res`,
  passive_fire_pierce: (v) => `-${v}% Enemy Fire Res`,
  passive_ltng_pierce: (v) => `-${v}% Enemy Light Res`,
  passive_cold_pierce: (v) => `-${v}% Enemy Cold Res`,
  passive_pois_pierce: (v) => `-${v}% Enemy Poison Res`,
  item_cannotbefrozen: () => 'CBF',
  item_halffreezeduration: () => 'HFD',
  item_crushingblow: (v) => `${v}% CB`,
  item_deadlystrike: (v) => `${v}% DS`,
  item_openwounds: (v) => `${v}% OW`,
  item_pierce: (v) => `${v}% Pierce`,
  lifedrainmindam: (v) => `${v}% LL`,
  manadrainmindam: (v) => `${v}% ML`,
  armorclass: (v) => `+${v} Def`,
  item_armor_percent: (v) => `${v}% ED`,
  maxdamage_percent: (v) => `${v}% ED`,
  max_damage: (v) => `+${v} Max Dmg`,
  item_attackertakesdamage: (v) => `${v} Thorns`,
  toblock: (v) => `${v}% Block`,
  item_demondamage_percent: (v) => `${v}% Dmg Demons`,
  item_demon_tohit: (v) => `+${v} AR Demons`,
  item_absorblight: (v) => `+${v} Light Absorb`,
  item_absorbfire: (v) => `+${v} Fire Absorb`,
  item_absorbcold: (v) => `+${v} Cold Absorb`,
  maxfireresist: (v) => `+${v}% Max Fire Res`,
  maxlightresist: (v) => `+${v}% Max Light Res`,
  maxcoldresist: (v) => `+${v}% Max Cold Res`,
  maxpoisonresist: (v) => `+${v}% Max Poison Res`,
  tohit: (v) => `+${v} AR`,
  item_tohit_percent: (v) => `${v}% AR`,
  normal_damage_reduction: (v) => `${v} PDR`,
  damageresist: (v) => `${v}% PDR`,
  magic_damage_reduction: (v) => `MDR ${v}`,
  hpregen: (v) => `+${v} Replenish Life`,
  item_manaafterkill: (v) => `${v} MAEK`,
  item_healafterkill: (v) => `${v} LAEK`,
};

const ELEMENT: Record<string, string> = { fire: 'Fire', light: 'Light', cold: 'Cold', pois: 'Poison' };
const CLASS = /^(Amazon|Assassin|Barbarian|Druid|Necromancer|Paladin|Sorceress)$/;
const LITTLE = new Set(['to', 'of', 'by', 'per', 'the', 'and', 'on', 'when', 'a', 'an']);

export function shortMod(m: Modifier): string {
  const value = m.values?.[0];
  // "+100 to Minimum Lightning Damage" with its maximum alongside is a damage range.
  const element = /^(fire|light|cold|pois)mindam$/.exec(m.name)?.[1];
  if (element && value !== undefined) return m.values.length > 1 ? `${value}-${m.values[1]} ${ELEMENT[element]}` : `+${value} Min ${ELEMENT[element]}`;
  const known = SHORT[m.name];
  if (known && value !== undefined) return known(value);
  // Skills by their kind, without the class: "+1 to Summoning Skills (Necromancer Only)" -> "+1 Summoning",
  // "+3 to Critical Strike (Amazon Only)" -> "+3 Critical Strike"; a class's own: "+2 Amazon Skills".
  const skill = /^([+-]?\d+) to (.+?)(?: Skill Levels| Skills)?( \(\w+ Only\))?$/.exec(m.label);
  if (skill && (skill[3] || / Skill/.test(m.label))) return CLASS.test(skill[2]) ? `${skill[1]} ${skill[2]} Skills` : `${skill[1]} ${skill[2]}`;
  // "Adds 14-34 Fire Damage" -> "14-34 Fire".
  const adds = /^Adds (\d+)-(\d+) (\w+) Damage$/.exec(m.label);
  if (adds) return `${adds[1]}-${adds[2]} ${adds[3]}`;
  const amount = /[+-]?\d+%?/.exec(m.label)?.[0] ?? '';
  const words = m.label
    .replace(amount, '')
    .replace(/\bChance (?:of|to)\b|\bTaken\b/g, '') // "Chance of Deadly Strike" is DS, "Damage Taken Reduced" DR
    .split(/[\s/]+/)
    .filter((w) => w && !LITTLE.has(w.toLowerCase()) && /^[A-Za-z]/.test(w));
  const capitals = words.filter((w) => /^[A-Z]/.test(w));
  const name = capitals.length > 1 ? capitals.map((w) => w[0]).join('') : (capitals[0] ?? words.join(' '));
  return [amount, name].filter(Boolean).join(' ');
}

const NOTE_MAX = 60;

/**
 * What sets an item's price, short: every property of a magic, rare or crafted item; only the rolled
 * ones (and corruptions) of anything else, as torch listings read ("+3 Sorceress Skills / +45 Vit").
 */
export function listingStats(item: Item): string {
  const facet = facetRoll(item);
  if (facet) return `${facet.dmg}/${facet.pierce} ${facet.label}`;
  const all = ['Magic', 'Rare', 'Crafted'].includes(item.quality.name);
  const mods = (item.modifiers ?? [])
    .filter((m) => m.name !== 'corrupted' && m.name !== 'item_corrupted' && !m.name.startsWith('map_'))
    .filter((m) => all || m.corrupted || m.name === 'item_addclassskills' || (m.min !== undefined && m.max !== undefined && m.min < m.max))
    .sort((a, b) => b.priority - a.priority)
    // Defense ED next to damage ED (Alma Negra) needs telling apart.
    .map((m) => (m.name === 'item_armor_percent' && item.modifiers.some((o) => o.name === 'maxdamage_percent') ? `${m.values[0]}% ED Def` : shortMod(m)));
  // Highest priority first, dropping the rest past NOTE_MAX characters.
  let text = '';
  for (const s of mods) if ((text ? text.length + 3 : 0) + s.length <= NOTE_MAX) text = text ? `${text} / ${s}` : s;
  return text;
}

/** A price as buyers write it: below 0.2 HR in Worldstone Shards, 1 WSS = 0.01 HR ("0.05" -> "5 WSS"). */
export function priceText(hr: string): string {
  const v = Number(hr.trim());
  if (!hr.trim() || !Number.isFinite(v)) return hr.trim();
  return v > 0 && v < 0.2 ? `${Math.round(v * 100)} WSS` : `${hr.trim()} HR`;
}

/** The note buyers see on a listing: the price, then the stats ("0.5 HR (40% ED / 15% IAS / 20% MF)"). */
export function listingNote(item: Item, hr: string): string {
  const stats = listingStats(item);
  return [priceText(hr), stats && `(${stats})`].filter(Boolean).join(' ');
}
