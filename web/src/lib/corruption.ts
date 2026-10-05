import { shortMod } from './modShort';
import type { Item } from './types';

const CORRUPTED_MARKERS = new Set(['corrupted', 'item_corrupted']);
/** A slam that turned a unique, set or crafted find into a rare. */
export const isBricked = (item: Item, original?: Item | null) =>
  !!(item as Item & { bricked?: boolean }).bricked ||
  (!!original && ['Unique', 'Set', 'Crafted'].includes(original.quality?.name ?? '') && item.quality?.name === 'Rare');

export const isCorrupted = (item: Item) => item.corrupted || (item.modifiers ?? []).some((m) => CORRUPTED_MARKERS.has(m.name));

/**
 * What a corruption gave, short ("CBF", "+30 Life"): the lines it marked; with none, the
 * sockets (a socket corruption adds no line). Null when the item isn't corrupted.
 */
export function corruption(item: Item): string | null {
  if (!isCorrupted(item)) return null;
  const lines = (item.modifiers ?? []).filter((m) => m.corrupted && !CORRUPTED_MARKERS.has(m.name)).map(shortMod);
  if (!lines.length && item.socket_count > 0) return `${item.socket_count} OS`;
  return lines.join(', ');
}
