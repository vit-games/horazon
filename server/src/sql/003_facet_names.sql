-- Rainbow Facets found by the capture were stored as an unidentified "Jewel": the site data has one
-- Rainbow Facet row for the game's several, so its in-game index named nothing. Name them (their
-- stats were stored), so they show as facets and count for the grail.
UPDATE drops
   SET name = 'Rainbow Facet',
       item = item || '{"name": "Rainbow Facet", "is_identified": true}'::jsonb
 WHERE source = 'capture' AND base_code = 'jew' AND item->'quality'->>'name' = 'Unique'
   AND item->>'name' = 'Jewel' AND jsonb_array_length(COALESCE(item->'modifiers', '[]')) > 0;
