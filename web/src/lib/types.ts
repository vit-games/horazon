// Subset of the api.projectdiablo2.com stash item shape that the UI reads.
// Field names mirror the API (see pd2-trade's GameStashResponse.ts).

export interface Modifier {
  name: string;
  label: string;
  values: number[];
  priority: number;
  min?: number;
  max?: number;
  corrupted?: boolean;
  desecrated?: boolean;
}

export interface DamageRange {
  minimum: number;
  maximum: number;
}

export interface Item {
  id: number;
  name: string;
  base_code: string;
  quality: { id: number; name: string };
  base: {
    id: string;
    name: string;
    category: string;
    type: string;
    type_code: string;
    size: { width: number; height: number };
  };
  is_identified: boolean;
  is_ethereal: boolean;
  is_simple: boolean;
  is_runeword: boolean;
  corrupted: boolean;
  socket_count: number;
  graphic_id: number | boolean | null;
  item_level?: number;
  quantity?: number;
  defense?: { base: number; total?: number };
  damage?: { one_handed?: Partial<DamageRange>; two_handed?: Partial<DamageRange>; missile?: Partial<DamageRange> };
  requirements?: { level?: number; strength?: number; dexterity?: number };
  modifiers: Modifier[];
}

export interface Drop {
  id: number;
  found_at: string;
  character: string | null;
  quantity: number;
  item: Item;
  /** 'character' | 'stash' | 'stack' | 'sample' */
  source?: string;
  ignored?: boolean;
  /** A craft the player kept (notable); bad crafts are ignored instead. */
  kept?: boolean;
  /** The item as it dropped, when it has since changed in place (slammed, socketed). */
  original_item?: Item | null;
  item_updated_at?: string | null;
  /** Kept (or binned) instead of sold: off the Trade review list. */
  stashed_at?: string | null;
  /** Pinned to haul card 0-2 on the Drops page, and when. */
  pin_slot?: number | null;
  pinned_at?: string | null;
}

export interface StatSample {
  t: string;
  character: string;
  stat: string;
  value: number;
  approximate: boolean;
}

export interface CharacterInfo {
  name: string;
  samples: number;
  drops: number;
  last_seen: string;
  /** From the capture's join packet or the armory; null until known. */
  class: string | null;
  level: number | null;
  /** From its latest captured game; false for a non-ladder character, null until known. */
  ladder?: boolean | null;
}

export interface StatsResponse {
  character: string | null;
  characters: CharacterInfo[];
  samples: StatSample[];
}
