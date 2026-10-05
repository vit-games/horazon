import type { CaptureGame } from './capture';

/** Experience needed for each level (index = level), from Diablo II's experience.txt; PD2 keeps it. */
const LEVEL_XP = [
  0, 0, 500, 1500, 3750, 7875, 14175, 22680, 32886, 44396, 57715, 72144, 90180, 112725, 140906, 176132, 220165, 275207,
  344008, 430010, 537513, 671891, 839864, 1049830, 1312287, 1640359, 2050449, 2563061, 3203826, 3902260, 4663553,
  5493363, 6397855, 7383752, 8458379, 9629723, 10906488, 12298162, 13815086, 15468534, 17270791, 19235252, 21376515,
  23710491, 26254525, 29027522, 32050088, 35344686, 38935798, 42850109, 47116709, 51767302, 56836449, 62361819,
  68384473, 74949165, 82104680, 89904191, 98405658, 107672256, 117772849, 128782495, 140783010, 153863570, 168121381,
  183662396, 200602101, 219066380, 239192444, 261129853, 285041630, 311105466, 339515048, 370481492, 404234916,
  441026148, 481128591, 524840254, 572485967, 624419793, 681027665, 742730244, 809986056, 883294891, 963201521,
  1050299747, 1145236814, 1248718217, 1361512946, 1484459201, 1618470619, 1764543065, 1923762030, 2097310703,
  2286478756, 2492671933, 2717422497, 2962400612, 3229426756, 3520485254,
];
export const MAX_LEVEL = 99;

/** Experience as a level with the fraction reached into the next one (94.61); 99 at the cap. */
export function levelOf(xp: number): number {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= LEVEL_XP[lvl + 1]) lvl++;
  return lvl === MAX_LEVEL ? MAX_LEVEL : lvl + (xp - LEVEL_XP[lvl]) / (LEVEL_XP[lvl + 1] - LEVEL_XP[lvl]);
}

/** Experience still needed for the next level. */
export const xpToNext = (xp: number) => LEVEL_XP[Math.floor(levelOf(xp)) + 1] - xp;

export interface SessionXp {
  character: string | null;
  /** Levels with their fraction, at the session's first and latest reading. */
  from: number;
  now: number;
  /** What deaths cost, in levels (of the level they happened in, near enough) - net of corpse pickups. */
  lost: number;
  died: number;
  /** Net experience per hour over the session; null when too short to say. */
  perHour: number | null;
  /** Hours until the next level at that pace. */
  hoursToNext: number | null;
}

/**
 * The session's experience for the character played last: games of the session with a reading.
 * Null without readings (captures before XP was read, a mid-game start) or at level 99.
 */
export function sessionXp(games: CaptureGame[], start: Date, end: Date): SessionXp | null {
  const inSession = games
    .filter((g) => new Date(g.started_at) >= start && new Date(g.started_at) <= end && g.xp_end !== null && g.xp_start !== null)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const character = inSession.at(-1)?.character ?? null;
  const mine = inSession.filter((g) => g.character === character);
  if (!mine.length) return null;
  const first = mine[0].xp_start!;
  const last = mine.at(-1)!.xp_end!;
  const now = levelOf(last);
  if (now >= MAX_LEVEL) return null;
  const perLevel = LEVEL_XP[Math.floor(now) + 1] - LEVEL_XP[Math.floor(now)];
  const lostXp = mine.reduce((n, g) => n + (g.xp_lost ?? 0), 0);
  const hours = (new Date(mine.at(-1)!.ended_at).getTime() - new Date(mine[0].started_at).getTime()) / 3600e3;
  // Ten minutes in, the pace means something; before that one kill swings it.
  const perHour = hours >= 1 / 6 ? (last - first) / hours : null;
  return {
    character,
    from: levelOf(first),
    now,
    lost: lostXp / perLevel,
    died: mine.reduce((n, g) => n + g.died, 0),
    perHour,
    hoursToNext: perHour && perHour > 0 ? xpToNext(last) / perHour : null,
  };
}
