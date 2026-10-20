-- The Guild Hall (one area per guild level, 202-206, Season 14) and the PvP arenas (157, 159, 166) are
-- towns, not zones: drop the zone runs they opened.
DELETE FROM map_runs WHERE kind = 'zone' AND area IN (157, 159, 166, 202, 203, 204, 205, 206);
