-- Whether a game was a ladder game, from its join packet (0x01); null for games captured
-- before this was read. A character's ladder status is that of its latest game.
ALTER TABLE games ADD COLUMN ladder boolean;
