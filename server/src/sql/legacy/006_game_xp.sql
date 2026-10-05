-- The character's experience in a game: at the first and latest reading, and what deaths cost
-- in it (net of what picking up the corpse gave back). NULL: no reading (older captures).
ALTER TABLE games ADD COLUMN xp_start bigint;
ALTER TABLE games ADD COLUMN xp_end bigint;
ALTER TABLE games ADD COLUMN xp_lost bigint;
