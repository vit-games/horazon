import type { ReactNode } from 'react';
import { EVENT_LABEL } from '../lib/capture';

// 16px line icons for map events, drawn in currentColor.
const PATHS: Record<string, ReactNode> = {
  // Dark Wanderer: a hooded figure
  dark_wanderer: (
    <>
      <path d="M8 1.75c-2.9 0-4.5 2.4-4.5 5.4v6.85h9V7.15c0-3-1.6-5.4-4.5-5.4z" />
      <path d="M6.25 7.75h.01M9.75 7.75h.01" strokeWidth={2.2} strokeLinecap="round" />
    </>
  ),
  // Shadow of Mendeln: a skull (undead waves)
  mendeln: (
    <>
      <path d="M3.5 7.25a4.5 4.5 0 1 1 9 0v2.25l-1.5 1v2.75H5V10.5l-1.5-1z" />
      <circle cx="6.25" cy="7.5" r="1" />
      <circle cx="9.75" cy="7.5" r="1" />
    </>
  ),
  // Horazon: a portal
  horazon: (
    <>
      <ellipse cx="8" cy="8" rx="4.75" ry="6.25" />
      <ellipse cx="8" cy="8" rx="2.25" ry="3.5" />
    </>
  ),
  // A corrupted map: an asterisk, in corruption red (the game's colour for corruption)
  corrupted: <path d="M8 2.5v11M3.25 5.25l9.5 5.5M12.75 5.25l-9.5 5.5" strokeLinecap="round" />,
  // A heroic map (a Standard of Heroes used on it): a banner on its pole
  heroic: (
    <>
      <path d="M4 14.25V1.75" strokeLinecap="round" />
      <path d="M4 2.5h8.5l-2 3 2 3H4" />
    </>
  ),
  // A catalyzed map (a Catalyst Shard used on it): a cracked gem
  catalyzed: (
    <>
      <path d="M8 1.75 13.25 8 8 14.25 2.75 8z" />
      <path d="M8 1.75 6.9 5.4 8.9 7.6 7.4 10.4 8 14.25" strokeLinecap="round" />
    </>
  ),
  // Treasure Fallen: a loot sack
  treasure_fallen: (
    <>
      <path d="M6 2.25h4L9 5c2.6 1 4 3.1 4 5.6 0 2-1.6 3.15-5 3.15s-5-1.15-5-3.15C3 8.1 4.4 6 7 5z" />
      <path d="M6.75 5h2.5" />
    </>
  ),
  // Spire of Darkness: a tower
  spire: (
    <>
      <path d="M6.25 13.75V5.5L8 1.75l1.75 3.75v8.25" />
      <path d="M4.25 13.75h7.5M6.25 9h3.5" />
    </>
  ),
  // Gheed: a stack of coins
  gheed: (
    <>
      <ellipse cx="8" cy="4.5" rx="4.5" ry="2" />
      <path d="M3.5 4.5v3.25c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V4.5" />
      <path d="M3.5 7.75V11c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V7.75" />
    </>
  ),
  // Altar of the Catalyst: a crystal
  catalyst_altar: (
    <>
      <path d="M8 1.5l3.75 4.5L8 14.5 4.25 6z" />
      <path d="M4.25 6h7.5M8 1.5v13" />
    </>
  ),
  // Map boss: a horned skull
  boss: (
    <>
      <path d="M2.75 2.25c.25 2.25 1.25 3.6 2.75 4.25M13.25 2.25c-.25 2.25-1.25 3.6-2.75 4.25" />
      <path d="M4.25 9.25a3.75 3.75 0 1 1 7.5 0V11l-1.25.75v2h-5v-2L4.25 11z" />
      <circle cx="6.6" cy="9.25" r=".8" />
      <circle cx="9.4" cy="9.25" r=".8" />
    </>
  ),
  // The player's death: a plain skull
  death: (
    <>
      <path d="M3.5 7.25a4.5 4.5 0 1 1 9 0c0 1.5-.75 2.6-1.75 3.2v2.8h-5.5v-2.8C4.25 9.85 3.5 8.75 3.5 7.25z" />
      <path d="M7 13.25v-1.5M9 13.25v-1.5" />
      <circle cx="6.25" cy="7.5" r="1" />
      <circle cx="9.75" cy="7.5" r="1" />
    </>
  ),
  // Map affixes adding monsters (wiki.projectdiablo2.com/wiki/Maps#Affixes), keyed by stat.
  // Minions of Destruction: a screaming face
  map_glob_add_mon_shriek: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M6 6.5h.01M10 6.5h.01" strokeWidth={2} strokeLinecap="round" />
      <ellipse cx="8" cy="10.5" rx="1.4" ry="2" />
    </>
  ),
  // Stygian Dolls: a big-headed doll
  map_glob_add_mon_doll: (
    <>
      <circle cx="8" cy="5" r="3.25" />
      <path d="M8 8.25v3.5M5 9.75h6M8 11.75l-2 2.5M8 11.75l2 2.5" />
    </>
  ),
  // Succubus Witches: a horned head
  map_glob_add_mon_succ: (
    <>
      <path d="M4.75 2.5c0 1.6.6 2.6 1.6 3.2M11.25 2.5c0 1.6-.6 2.6-1.6 3.2" />
      <circle cx="8" cy="8.25" r="2.75" />
      <path d="M4 14.5c.5-1.9 1.9-3 4-3s3.5 1.1 4 3" />
    </>
  ),
  // Vampire Lords: a bat
  map_glob_add_mon_vamp: (
    <path d="M8 6.25C6.6 4.4 4.1 3.6 1.75 4.4c1.1 1.4 1.1 3.6 2.6 4.6.9-.9 2.6-.9 3.65.8 1.05-1.7 2.75-1.7 3.65-.8 1.5-1 1.5-3.2 2.6-4.6-2.35-.8-4.85 0-6.25 1.85z" />
  ),
  // Hell Bovines: a cow's head
  map_glob_add_mon_cow: (
    <>
      <path d="M2.75 4c.4 1.6 1.5 2.4 2.75 2.5M13.25 4c-.4 1.6-1.5 2.4-2.75 2.5" />
      <path d="M5.5 6.5h5l.5 4.75c0 1.9-1.4 3-3 3s-3-1.1-3-3z" />
      <path d="M6.9 12.25h.01M9.1 12.25h.01" strokeWidth={1.8} strokeLinecap="round" />
    </>
  ),
  // Reanimated Horde: a hand rising from the ground
  map_glob_add_mon_horde: (
    <>
      <path d="M2 14.25h12" />
      <path d="M6 14.25V5.5a1 1 0 0 1 2 0V9M8 8.5V4a1 1 0 0 1 2 0v5M10 9V6a1 1 0 0 1 2 0v4c0 2.2-1 4.25-3 4.25" />
    </>
  ),
  // Ghosts
  map_glob_add_mon_ghost: (
    <>
      <path d="M3.75 14.25V7.5a4.25 4.25 0 0 1 8.5 0v6.75l-1.4-1.2-1.45 1.2L8 13.05l-1.4 1.2-1.45-1.2z" />
      <path d="M6.5 7.5h.01M9.5 7.5h.01" strokeWidth={1.8} strokeLinecap="round" />
    </>
  ),
  // Burning Souls: a flame
  map_glob_add_mon_souls: (
    <path d="M8 1.75c.6 2.6 3.75 4 3.75 7.6a3.75 3.75 0 0 1-7.5 0C4.25 7.1 5.5 6 6 4.5c.75 1.25.5 2.5 0 3.25C7.5 7 8.25 4.5 8 1.75z" />
  ),
  // Fetishes: a tribal mask
  map_glob_add_mon_fetish: (
    <>
      <path d="M4.5 2.5h7V9c0 3-1.6 5-3.5 5S4.5 12 4.5 9z" />
      <path d="M6 6.5h1.25M8.75 6.5H10M6.5 10.5h3" />
    </>
  ),
  // Duplicated: the boss skull with a plus
  map_glob_extra_boss: (
    <>
      <path d="M3 9.75a3.5 3.5 0 1 1 7 0v1.5l-1.1.7v1.8H4.1v-1.8L3 11.25z" />
      <path d="M5.4 9.75h.01M7.6 9.75h.01" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M12.5 1.75v4.5M10.25 4h4.5" />
    </>
  ),
  // Fortified: a shield
  map_glob_skirmish_mode: <path d="M8 1.75l5.25 2v4c0 3.25-2.25 5.5-5.25 6.5-3-1-5.25-3.25-5.25-6.5v-4z" />,
  // Invaders: crossed swords
  invaders: (
    <>
      <path d="M3 3l8.5 8.5M13 3l-8.5 8.5" />
      <path d="M9.75 12.75l3-3M3.25 9.75l3 3" />
    </>
  ),
};

/** One colour per event kind, from the item-quality palette so they read on the dark panels. */
export const EVENT_COLOR: Record<string, string> = {
  dark_wanderer: 'text-q-magic',
  mendeln: 'text-q-set',
  horazon: 'text-q-crafted',
  treasure_fallen: 'text-q-unique',
  spire: 'text-q-gray',
  gheed: 'text-q-rare',
  catalyst_altar: 'text-q-normal',
  invaders: 'text-q-red',
  death: 'text-q-red',
  map_glob_add_mon_shriek: 'text-q-magic',
  map_glob_add_mon_doll: 'text-q-crafted',
  map_glob_add_mon_succ: 'text-q-red',
  map_glob_add_mon_vamp: 'text-q-red',
  map_glob_add_mon_cow: 'text-q-normal',
  map_glob_add_mon_horde: 'text-q-set',
  map_glob_add_mon_ghost: 'text-q-magic',
  map_glob_add_mon_souls: 'text-q-crafted',
  map_glob_add_mon_fetish: 'text-q-rare',
  map_glob_extra_boss: 'text-q-unique',
  map_glob_skirmish_mode: 'text-q-gray',
};

/**
 * What was used on a map before it was opened, read from the map item's own properties
 * (wiki.projectdiablo2.com/wiki/Maps): a corruption, a Standard of Heroes (Heroic), a Catalyst
 * Shard (its random event) and a Fortify orb (Fortified). Each is its own property, so one never
 * hides another.
 */
const MAP_CRAFTS = [
  { stat: 'corrupted', kind: 'corrupted', color: 'text-q-red', title: 'Corrupted map' },
  { stat: 'heroic', kind: 'heroic', color: 'text-q-unique', title: 'Heroic: a Standard of Heroes was used on it' },
  { stat: 'map_force_event', kind: 'catalyzed', color: 'text-q-magic', title: 'Catalyzed: a Catalyst Shard added a random event' },
  { stat: 'map_glob_skirmish_mode', kind: 'map_glob_skirmish_mode', color: 'text-q-gray', title: 'Fortified: a Fortify orb was used on it' },
];
export const MAP_CRAFT_STATS = new Set(MAP_CRAFTS.map((c) => c.stat));

/** The map's craft marks in a row (nothing for a map with none, or a zone). */
export function MapCrafts({ stats, size = 16, className = '' }: { stats: { stat: string }[] | null | undefined; size?: number; className?: string }) {
  const marks = MAP_CRAFTS.filter((c) => stats?.some((m) => m.stat === c.stat));
  if (!marks.length) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {marks.map((c) => (
        <EventIcon key={c.stat} kind={c.kind} size={size} title={c.title} className={c.color} />
      ))}
    </span>
  );
}

/** Icon for a map event kind or a map content property (nothing for unknown kinds). */
export function EventIcon({ kind, size = 16, title, className }: { kind: string; size?: number; title?: string; className?: string }) {
  const path = PATHS[kind];
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className ?? EVENT_COLOR[kind] ?? 'text-text'}`}
      role="img"
      aria-label={title ?? EVENT_LABEL[kind]}
    >
      <title>{title ?? EVENT_LABEL[kind]}</title>
      {path}
    </svg>
  );
}
