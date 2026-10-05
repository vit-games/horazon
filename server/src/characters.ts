import { pool } from './db.js';
import { notify } from './events.js';
import { fetchCharacter } from './pd2api.js';

export interface CharacterInfo {
  class: string | null;
  level: number | null;
}

/** Record a character's class and/or level (from the capture or the armory). */
export async function saveCharacterInfo(name: string, info: Partial<CharacterInfo>) {
  const { rowCount } = await pool.query(
    `INSERT INTO character_info (name, class, level) VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE SET class = COALESCE($2, character_info.class), level = COALESCE($3, character_info.level), updated_at = now()
     WHERE character_info.class IS DISTINCT FROM COALESCE($2, character_info.class) OR character_info.level IS DISTINCT FROM COALESCE($3, character_info.level)`,
    [name, info.class ?? null, info.level ?? null],
  );
  if (rowCount) notify('stats');
}

/** Characters already looked up on the armory since start, found or not. */
const lookedUp = new Set<string>();

/**
 * Characters the capture never saw join (played before it ran) get their class and level
 * from the public armory, once per start - in the background, the list updates after.
 */
export function lookUpMissing(names: string[]) {
  for (const name of names) {
    if (lookedUp.has(name)) continue;
    lookedUp.add(name);
    fetchCharacter(name)
      .then((res) => saveCharacterInfo(name, { class: res.character.class?.name ?? null, level: res.character.level ?? null }))
      .catch(() => {}); // unknown or private: shown without
  }
}
