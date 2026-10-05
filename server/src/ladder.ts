/**
 * Non-ladder characters: their latest game with captured flags was non-ladder (a character
 * from an earlier season, say). SQL for `character NOT IN ${NON_LADDER_CHARACTERS}`: a
 * season's progress (drops and grail in a season range) leaves them out; all time keeps them.
 */
export const NON_LADDER_CHARACTERS = `(SELECT character FROM (
    SELECT DISTINCT ON (character) character, ladder FROM games
     WHERE character IS NOT NULL AND ladder IS NOT NULL ORDER BY character, started_at DESC) latest
  WHERE NOT ladder)`;
