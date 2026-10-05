-- Uber boss fights are map_runs of kind 'boss' (boss = the encounter: Lucion, Rathma...).
-- boss_tier: the summon item's cubed tier (0-2); summoned_at: when it was used, shared by the
-- runs of one fight across rejoins. boss_seconds on a boss run counts from summoned_at.
ALTER TABLE map_runs ADD COLUMN boss_tier integer;
ALTER TABLE map_runs ADD COLUMN summoned_at timestamptz;
-- The lowest HP (%) the boss was brought to in the run: how close it came; 0 once killed.
ALTER TABLE map_runs ADD COLUMN boss_hp integer;
-- Per boss of the encounter, its lowest HP (%) ({"bosses": {"Mephisto": 0, "Diablo": 40}}), and for
-- Rathma the phase reached (1-3; boss HP counts in the last arena only).
ALTER TABLE map_runs ADD COLUMN boss_detail jsonb;
-- Runs in uber arenas captured before this were taken for maps (or zones); they become boss
-- runs of unknown tier (areas as UBER_AREAS in capture.ts).
UPDATE map_runs SET kind = 'boss', map_code = NULL, map_quality = NULL, map_stats = NULL, boss_seconds = NULL, boss_tracked = true,
  boss = CASE WHEN area IN (136, 185) THEN 'Uber Tristram' WHEN area = 137 THEN 'Diablo Clone' WHEN area IN (161, 162, 163) THEN 'Rathma'
              WHEN area = 168 THEN 'Uber Ancients' ELSE 'Lucion' END
 WHERE area IN (136, 137, 161, 162, 163, 168, 185, 188, 189) AND kind IN ('map', 'zone');
