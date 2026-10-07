// Pixel-art class sprites (SpriteCook, see web/src/assets/icons/README.md), each a signature of the class:
//   Amazon an arrow · Sorceress Nova · Necromancer a skull · Paladin a holy shield
//   Barbarian an axe · Druid a wolf's head · Assassin claw marks · a hooded figure when the class isn't known yet
const SPRITES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../assets/icons/class/*.png', { eager: true, import: 'default' })).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1, -4),
    url,
  ]),
);

/** The seven classes, in the game's order. */
export const CLASSES = ['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian', 'Druid', 'Assassin'];

/** A character class's icon; a hooded figure when the class isn't known yet. */
export function ClassIcon({ cls, size = 16, className }: { cls: string | null | undefined; size?: number; className?: string }) {
  const src = (cls && SPRITES[cls]) || SPRITES.unknown;
  const label = cls ?? 'Class not known yet';
  return <img src={src} width={size} height={size} alt={label} title={label} draggable={false} className={`inline-block shrink-0 ${className ?? ''}`} />;
}
