-- Finds left on the ground when their game ended: hidden like `ignored` drops, but a unique
-- or set identified before it was dropped still counts for the grail.
ALTER TABLE drops ADD COLUMN discarded boolean NOT NULL DEFAULT false;
