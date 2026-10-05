import type { ReactNode } from 'react';

// 16px class icons, each a signature of the class, drawn in currentColor like EventIcon: bold
// silhouettes with filled masses so they still read at 12px in run rows.
//   Amazon an arrow · Sorceress Nova · Necromancer a skull · Paladin a holy shield
//   Barbarian an axe · Druid a wolf's head · Assassin claw blades
const PATHS: Record<string, ReactNode> = {
  Amazon: (
    <>
      <path d="M3 13 11.5 4.5" />
      <path d="M13.5 2.5 12.75 7.25 8.75 3.25z" fill="currentColor" />
      <path d="M3 13H1.75M3 13v1.25M5 11H3.25M5 11v1.75" />
    </>
  ),
  Sorceress: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.25 9 7l2.75 1L9 9l-1 2.75L7 9 4.25 8 7 7z" fill="currentColor" />
    </>
  ),
  Necromancer: (
    <>
      <path d="M3.25 7.25a4.75 4.75 0 0 1 9.5 0c0 1.5-.75 2.5-1.75 3v2.5h-6v-2.5c-1-.5-1.75-1.5-1.75-3z" />
      <path d="M5.5 7.25h1.5v1.25H5.5zM9 7.25h1.5v1.25H9z" fill="currentColor" />
      <path d="M7 12.75v-1.5M9 12.75v-1.5" />
    </>
  ),
  Paladin: (
    <>
      <path d="M8 1.75 13 3.5v4c0 3.25-2.25 5.5-5 6.75C5.25 13 3 10.75 3 7.5v-4z" />
      <path d="M8 4.5v6.5M5.5 7h5" />
    </>
  ),
  Barbarian: (
    <>
      <path d="M2.25 13.75 12.5 3.5" />
      <path d="M8 7.25 11.25 4c.75 1.75 2.25 2.75 3.5 2.75-.25 2.5-2 4.5-4.25 4.75 0-1.25-.75-3-2.5-4.25z" fill="currentColor" />
    </>
  ),
  Druid: (
    <>
      <path d="M2.75 1.75 5.5 5h5l2.75-3.25.25 6.5-2.75 3.5L8 14.25 5.25 11.75 2.5 8.25z" />
      <path d="M5.75 7.75l1.5.75M10.25 7.75l-1.5.75" />
    </>
  ),
  Assassin: (
    <>
      <path d="M4 10 10.5 2M6.5 11 13 3M9 12l4.5-5.5" />
      <path d="M2.5 10.25 9.75 13.5" strokeWidth={2} />
    </>
  ),
};

/** The seven classes, in the game's order. */
export const CLASSES = Object.keys(PATHS);

/** One colour per class, from its own palette (index.css --color-class-*). */
const CLASS_COLOR: Record<string, string> = {
  Amazon: 'text-class-amazon',
  Sorceress: 'text-class-sorceress',
  Necromancer: 'text-class-necromancer',
  Paladin: 'text-class-paladin',
  Barbarian: 'text-class-barbarian',
  Druid: 'text-class-druid',
  Assassin: 'text-class-assassin',
};

/** A character class's icon; a plain person outline when the class isn't known yet. */
export function ClassIcon({ cls, size = 16, className }: { cls: string | null | undefined; size?: number; className?: string }) {
  const path = (cls && PATHS[cls]) || (
    <>
      <circle cx="8" cy="5" r="2.75" />
      <path d="M2.75 14.25c.5-3 2.5-4.75 5.25-4.75s4.75 1.75 5.25 4.75" />
    </>
  );
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className ?? (cls && CLASS_COLOR[cls]) ?? 'text-muted'}`}
      role="img"
      aria-label={cls ?? 'Unknown class'}
    >
      <title>{cls ?? 'Class not known yet'}</title>
      {path}
    </svg>
  );
}
