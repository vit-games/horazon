-- A listing that ended unsold leaves its item in your stash: the Trade tab lists it with the
-- stashed ones (there is no separate "Not sold" list any more). Listings closed unsold before
-- this change stash their drop, as closing one does from now on.
UPDATE drops d SET stashed_at = l.closed_at
  FROM listings l
 WHERE l.drop_id = d.id AND l.outcome = 'unsold' AND d.stashed_at IS NULL;
