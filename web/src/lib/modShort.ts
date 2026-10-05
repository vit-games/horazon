import type { Modifier } from './types';

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
  item_maxdamage_percent: (v) => `${v}% ED`,
  tohit: (v) => `+${v} AR`,
  item_tohit_percent: (v) => `${v}% AR`,
  normal_damage_reduction: (v) => `DR ${v}`,
  damageresist: (v) => `${v}% PDR`,
  magic_damage_reduction: (v) => `MDR ${v}`,
  hpregen: (v) => `+${v} Replenish Life`,
  item_manaafterkill: (v) => `+${v} Mana/Kill`,
  item_healafterkill: (v) => `+${v} Life/Kill`,
};

const LITTLE = new Set(['to', 'of', 'by', 'per', 'the', 'and', 'on', 'when', 'a', 'an']);

export function shortMod(m: Modifier): string {
  const value = m.values?.[0];
  const known = SHORT[m.name];
  if (known && value !== undefined) return known(value);
  // "+3 to Cold Skills" -> "+3 Cold Skills", "+2 to Amazon Skill Levels" -> "+2 Amazon Skills".
  if (/^[+-]?\d+ to .* Skill(s| Levels)?$/i.test(m.label)) return m.label.replace(' to ', ' ').replace(/ Skill Levels$/, ' Skills');
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
