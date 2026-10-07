import { EVENT_LABEL } from '../lib/capture';

// Pixel-art sprites for map events and map content properties (SpriteCook, see web/src/assets/icons/README.md),
// one PNG per kind named after it (the Horazon portal is an animated WebP).
const SPRITES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../assets/icons/event/*.{png,webp}', { eager: true, import: 'default' })).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1, path.lastIndexOf('.')),
    url,
  ]),
);

/**
 * What was used on a map before it was opened, read from the map item's own properties
 * (wiki.projectdiablo2.com/wiki/Maps): a corruption, a Standard of Heroes (Heroic), a Catalyst
 * Shard (its random event), a player ear (Treacherous) and a Fortify orb (Fortified). Each is its own property, so one never
 * hides another.
 */
const MAP_CRAFTS = [
  { stat: 'corrupted', kind: 'corrupted', title: 'Corrupted map' },
  { stat: 'heroic', kind: 'heroic', title: 'Heroic: a Standard of Heroes was used on it' },
  { stat: 'map_force_event', kind: 'catalyzed', title: 'Catalyzed: a Catalyst Shard added a random event' },
  { stat: 'treacherous', kind: 'treacherous', title: 'Treacherous: a player ear was used on it' },
  { stat: 'map_glob_skirmish_mode', kind: 'map_glob_skirmish_mode', title: 'Fortified: a Fortify orb was used on it' },
];
export const MAP_CRAFT_STATS = new Set(MAP_CRAFTS.map((c) => c.stat));

/** The map's craft marks in a row (nothing for a map with none, or a zone). */
export function MapCrafts({ stats, size = 16, className = '' }: { stats: { stat: string }[] | null | undefined; size?: number; className?: string }) {
  const marks = MAP_CRAFTS.filter((c) => stats?.some((m) => m.stat === c.stat));
  if (!marks.length) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {marks.map((c) => (
        <EventIcon key={c.stat} kind={c.kind} size={size} title={c.title} />
      ))}
    </span>
  );
}

/** Icon for a map event kind or a map content property (nothing for unknown kinds). */
export function EventIcon({ kind, size = 16, title, className }: { kind: string; size?: number; title?: string; className?: string }) {
  const src = SPRITES[kind];
  if (!src) return null;
  const label = title ?? EVENT_LABEL[kind];
  return <img src={src} width={size} height={size} alt={label} title={label} draggable={false} className={`inline-block shrink-0 ${className ?? ''}`} />;
}
