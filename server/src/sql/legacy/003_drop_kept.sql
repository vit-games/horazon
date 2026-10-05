-- Crafts the player marked as worth keeping: they count as notable drops like tiered items.
-- (Bad crafts are discarded with `ignored`.)
ALTER TABLE drops ADD COLUMN kept boolean NOT NULL DEFAULT false;
