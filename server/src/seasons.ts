import { fetchSeason } from './pd2api.js';
import { getCache, setCache } from './settings.js';

export interface Season {
  number: number;
  name: string;
  start: string;
  /** Next season's start; null for the current one. */
  end: string | null;
}

const toIso = (s: string) => new Date(s.replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1') + 'Z').toISOString();

/** Seasons from season 10 onward (older ones predate any tracked data), refreshed daily. */
export async function getSeasons(): Promise<Season[]> {
  const cached = await getCache<Season[]>('seasons');
  if (cached && Date.now() - cached.updated_at.getTime() < 24 * 3600e3) return cached.value;

  const found: { number: number; name: string; start: string }[] = [];
  for (let n = 10, misses = 0; misses < 2 && n < 60; n++) {
    try {
      const s = await fetchSeason(n);
      if (!s?.name || !s.start) throw new Error('empty');
      found.push({ number: n, name: s.name, start: toIso(s.start) });
      misses = 0;
    } catch {
      misses++;
    }
  }
  // The current season isn't always served by number; the unnumbered call returns it.
  const current = await fetchSeason().catch(() => null);
  if (current?.name && !found.some((s) => s.name === current.name)) {
    found.push({ number: Math.max(0, ...found.map((s) => s.number)) + 1, name: current.name, start: toIso(current.start) });
  }
  if (!found.length) return cached?.value ?? [];
  const seasons = found
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((s, i, all) => ({ ...s, end: all[i + 1]?.start ?? null }));
  await setCache('seasons', seasons);
  return seasons;
}
