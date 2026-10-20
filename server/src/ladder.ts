/**
 * Non-ladder characters as of a range's end: their latest game with captured flags started
 * before `until` was non-ladder. SQL for `character NOT IN ${nonLadderCharacters('$2')}`: a
 * season's progress (drops and grail in a season range) leaves them out; all time keeps them.
 * A ladder character moved to non-ladder at the season's end still counts for its season.
 */
export const nonLadderCharacters = (until: string) => `(SELECT character FROM (
    SELECT DISTINCT ON (character) character, ladder FROM games
     WHERE character IS NOT NULL AND ladder IS NOT NULL AND started_at < COALESCE(${until}::timestamptz, 'infinity')
     ORDER BY character, started_at DESC) latest
  WHERE NOT ladder)`;
