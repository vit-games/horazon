-- Grail items the player marked as found by hand (a backfill of finds made before tracking or
-- outside the capture). The grail no longer counts what a stash pull happens to see: only finds
-- the capture saw in a game, plus these marks. `owned_baseline` is kept but no longer read.
CREATE TABLE grail_marks (
  quality   text NOT NULL CHECK (quality IN ('Unique', 'Set')),
  name      text NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quality, name)
);
