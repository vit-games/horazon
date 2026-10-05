-- The schema as of the first public release, squashed from the pre-release migrations
-- 001_init.sql..030_slam_craft_names.sql (a database with all of those is moved onto this
-- file, see db.ts). Later changes are new NNN_*.sql files; never edit this one.

-- Character stat readings parsed from pd2_chat.log (.kills / .allstats output).
-- The log has no timestamps: observed_at is when the tracker read the line.
-- `approximate` marks the one-off baseline imported from pre-existing log content,
-- stamped with the file's mtime.
CREATE TABLE stat_samples (
  id          bigserial PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  character   text NOT NULL,
  stat        text NOT NULL,
  value       bigint NOT NULL,
  approximate boolean NOT NULL DEFAULT false
);
CREATE INDEX stat_samples_lookup_idx ON stat_samples (character, stat, observed_at);

-- Read position per watched log file, so restarts don't re-import lines. The game trims and
-- rewrites pd2_chat.log: `tail` keeps the last processed bytes so the watcher can find where
-- it left off in a rewritten file instead of re-importing old lines.
CREATE TABLE log_cursors (
  path       text PRIMARY KEY,
  position   bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  tail       bytea
);

-- Key/value app settings (token, account, tracked characters, ...).
CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

-- One row per polled source ("character:Vitsin", "stash:myaccount"): latest raw
-- snapshot, poll status, and whether its baseline has been taken.
CREATE TABLE sources (
  key            text PRIMARY KEY,
  baseline_at    timestamptz,
  game_saved_at  timestamptz,
  last_poll_at   timestamptz,
  last_error     text,
  snapshot       jsonb
);

-- Every unique item id ever seen in any source. An id is a drop the first time it
-- shows up after that source's baseline; moving it between sources keeps the id.
CREATE TABLE seen_items (
  item_id    bigint PRIMARY KEY,
  first_seen timestamptz NOT NULL DEFAULT now(),
  source     text NOT NULL
);

-- Simple items (runes, gems) have no id, so they're counted across all sources.
-- `committed` is the accepted total; an increase becomes a drop only once it has
-- persisted for a while (moving a rune char -> stash briefly counts it twice).
CREATE TABLE stack_counts (
  code          text PRIMARY KEY,
  committed     integer NOT NULL,
  pending_since timestamptz,
  pending_min   integer
);

-- Unique/set items already owned when tracking started - they count for the grail.
CREATE TABLE owned_baseline (
  item_id     bigint PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  name        text NOT NULL,
  quality     text NOT NULL,
  item        jsonb NOT NULL
);

-- Cached external data (seasons and the like).
CREATE TABLE cache (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Game sessions decoded from the PD2 game connection by the capture sidecar.
-- Ids come from the sidecar (connection start + client port). `corrupted_areas`: areas
-- corrupted in the game, from its "Corruption spreads in ..." notice at game start.
CREATE TABLE games (
  id              text PRIMARY KEY,
  character       text,
  server          text,
  region          text,
  started_at      timestamptz NOT NULL,
  ended_at        timestamptz,
  last_event_at   timestamptz NOT NULL,
  corrupted_areas integer[]
);
CREATE INDEX games_started_at_idx ON games (started_at DESC);

-- A map opened in a game. Only one map can be opened per game; a Horazon event opens
-- a map within the map, recorded as a child run (`parent_id`, kind 'horazon').
-- Non-map zones (corrupted zones, act bosses...) are runs too: kind 'zone', one per
-- zone per game; `corrupted` marks a corrupted zone once that can be detected.
--   map_candidates, map_item  the map item a run used, from the PD2 API (modifiers). At map
--                             use, every map in the API snapshots with the same base and
--                             quality is a candidate; the one that disappears from later
--                             snapshots is the map that was opened.
--   progress                  monster deaths over the run's active time (seconds spent in its
--                             areas) as [[seconds, deaths], ...], for the kill counter.
--   monsters_total            the map's monster total when the game reported how many were
--                             left (exact, unlike the estimate from earlier runs).
--   boss, boss_seconds        the map boss (capture/bosses.json) seen in the run and when it
--                             died, in active seconds; `boss_tracked` marks runs captured with
--                             boss tracking, so earlier runs aren't shown as skipping their boss.
--   map_stats                 the map's properties from its item packet when it was opened:
--                             [{stat, value, label}], most important first.
CREATE TABLE map_runs (
  id             bigserial PRIMARY KEY,
  game_id        text NOT NULL REFERENCES games ON DELETE CASCADE,
  parent_id      bigint REFERENCES map_runs ON DELETE CASCADE,
  kind           text NOT NULL,
  map_code       text,
  map_quality    text,
  map_ilvl       integer,
  map_uid        integer,
  area           integer NOT NULL,
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz,
  map_candidates jsonb,
  map_item       jsonb,
  corrupted      boolean,
  progress       jsonb,
  monsters_total integer,
  boss           text,
  boss_seconds   real,
  boss_tracked   boolean NOT NULL DEFAULT false,
  map_stats      jsonb
);
CREATE INDEX map_runs_started_at_idx ON map_runs (started_at DESC);
CREATE INDEX map_runs_game_idx ON map_runs (game_id);

-- Time spent in one area. Kills come from the game's kill counter at entry/exit, deaths
-- are monsters seen dying (any killer); `drops` counts ground drops by group
-- ({"unique": 2, "rune": 1, ...}).
CREATE TABLE area_visits (
  id           bigserial PRIMARY KEY,
  game_id      text NOT NULL REFERENCES games ON DELETE CASCADE,
  run_id       bigint REFERENCES map_runs ON DELETE SET NULL,
  area         integer NOT NULL,
  entered_at   timestamptz NOT NULL,
  left_at      timestamptz,
  kills_start  integer NOT NULL DEFAULT 0,
  kills_end    integer NOT NULL DEFAULT 0,
  drops        jsonb NOT NULL DEFAULT '{}',
  deaths_start integer NOT NULL DEFAULT 0,
  deaths_end   integer NOT NULL DEFAULT 0
);
CREATE INDEX area_visits_game_idx ON area_visits (game_id, entered_at);
CREATE INDEX area_visits_run_idx ON area_visits (run_id);

-- Map events announced by system notices ("An alternate dimension radiates dark energy...").
-- `data`: what the event produced - reward drops counted after it ({"drops": {"pk1": 2}}),
-- Gheed's shop offer and purchases ({"shop": [{code, quality, unit, bought, name}]}), the
-- invaders' classes ({"invaders": [...]}), Treasure Fallen's latest notice ({"lastAt": ms}).
CREATE TABLE map_events (
  id       bigserial PRIMARY KEY,
  game_id  text NOT NULL REFERENCES games ON DELETE CASCADE,
  run_id   bigint REFERENCES map_runs ON DELETE SET NULL,
  kind     text NOT NULL,
  area     integer,
  at       timestamptz NOT NULL,
  message  text NOT NULL,
  data     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX map_events_at_idx ON map_events (at DESC);

-- Items worth listing per run: drops identified in game (uniques, sets, rares...) and
-- pickups of items that never need identifying (runes, maps, ...). Unidentified items
-- picked up outside town wait here (kind 'pending') until identified, possibly in a later
-- game, so they count for the zone they dropped in.
CREATE TABLE capture_items (
  id           bigserial PRIMARY KEY,
  game_id      text NOT NULL REFERENCES games ON DELETE CASCADE,
  run_id       bigint REFERENCES map_runs ON DELETE SET NULL,
  at           timestamptz NOT NULL,
  kind         text NOT NULL,
  code         text NOT NULL,
  quality      text,
  ilvl         integer,
  uid          integer,
  ethereal     boolean NOT NULL DEFAULT false,
  dropped_here boolean NOT NULL DEFAULT true,
  area         integer
);
CREATE INDEX capture_items_run_idx ON capture_items (run_id);
CREATE INDEX capture_items_pending_idx ON capture_items (code, quality, at) WHERE kind = 'pending';

-- One row per item found: from the game capture, a stash snapshot diff or a currency count
-- increase. `item` keeps the item in the api.projectdiablo2.com format so rendering and
-- filters can evolve; the extracted columns are for indexing and filtering.
--   ignored              hides false positives (traded-in items, cube outputs) without losing them.
--   original_item        items change in place (corruption slams, socketing) while keeping
--                        their id: `item` follows the latest version, this keeps it as it dropped.
--   run_id, matched_at   drops seen by the capture are listed immediately (source 'capture');
--                        when the PD2 API later reports the same item it fills that row in
--                        (`matched_at`) instead of adding a second drop.
--   stashed_at           Trade review: the user decided to keep (or bin) it rather than sell.
--   pin_slot, pinned_at  pinned to one of the ten haul cards on the Drops page.
CREATE TABLE drops (
  id              bigserial PRIMARY KEY,
  found_at        timestamptz NOT NULL DEFAULT now(),
  game_item_id    bigint,
  character       text,
  name            text NOT NULL,
  base_code       text NOT NULL,
  quality         text NOT NULL,
  quantity        integer NOT NULL DEFAULT 1,
  item            jsonb NOT NULL,
  source          text NOT NULL,
  ignored         boolean NOT NULL DEFAULT false,
  original_item   jsonb,
  item_updated_at timestamptz,
  run_id          bigint REFERENCES map_runs ON DELETE SET NULL,
  matched_at      timestamptz,
  stashed_at      timestamptz,
  pin_slot        smallint CONSTRAINT drops_pin_slot_check CHECK (pin_slot BETWEEN 0 AND 9),
  pinned_at       timestamptz
);
CREATE INDEX drops_found_at_idx ON drops (found_at DESC);
CREATE INDEX drops_game_item_id_idx ON drops (game_item_id) WHERE game_item_id IS NOT NULL;
CREATE INDEX drops_capture_unmatched_idx ON drops (base_code, found_at) WHERE source = 'capture' AND matched_at IS NULL;

-- Our own listings on the projectdiablo2.com trade site, synced from the public market API.
-- How a listing ended is always entered by hand: the API has no "sold" flag, and deals are
-- often renegotiated in game, so `sold_hr` is the final price the user approved.
CREATE TABLE listings (
  id          text PRIMARY KEY,          -- market listing _id
  drop_id     bigint REFERENCES drops (id) ON DELETE SET NULL,
  item        jsonb NOT NULL,
  name        text NOT NULL,
  base_code   text NOT NULL,
  quality     text NOT NULL,
  ladder      boolean NOT NULL,
  hardcore    boolean NOT NULL,
  asking      text,                      -- price as posted, free text ("3 wss", "Ist + c/o")
  listed_at   timestamptz NOT NULL,
  bumped_at   timestamptz,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz,               -- first sync where it was no longer on the market
  outcome     text CHECK (outcome IN ('sold', 'unsold')),
  sold_hr     numeric CHECK (sold_hr >= 0),
  sold_price  text,                      -- the final deal as agreed, free text
  closed_at   timestamptz,
  asking_hr   numeric,                   -- the asking price in HR, next to the note
  CHECK ((outcome = 'sold') = (sold_hr IS NOT NULL))
);
CREATE INDEX listings_listed_at_idx ON listings (listed_at DESC);

-- Sales entered by hand outside item listings, so trade profit includes them: currency
-- (runes, uber mats, keys, ...) and/or services (carries, boss kills) described in `note`.
-- `items` = [{"code": "pk1", "qty": 3}, ...], empty for a pure service. `sample`: demo
-- sales (Settings -> sample data), removable like the other sample data.
CREATE TABLE manual_sales (
  id       bigserial PRIMARY KEY,
  sold_at  timestamptz NOT NULL DEFAULT now(),
  items    jsonb NOT NULL DEFAULT '[]',
  sold_hr  numeric NOT NULL CHECK (sold_hr >= 0),
  note     text,
  sample   boolean NOT NULL DEFAULT false,
  CHECK (jsonb_array_length(items) > 0 OR note IS NOT NULL)
);

-- Class and level of each character: from the capture (join packet, level stat), else
-- looked up once on the public armory.
CREATE TABLE character_info (
  name       text PRIMARY KEY,
  class      text,
  level      integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every corruption (slam) the capture saw, on any item: what it was and became (the items
-- as the capture decoded them), and whether it bricked (a unique, set or crafted item
-- turned rare). drop_id: the find it changed, if any.
CREATE TABLE slams (
  id             bigserial PRIMARY KEY,
  at             timestamptz NOT NULL,
  game_id        text,
  character      text,
  code           text NOT NULL,
  before_quality text,
  after_quality  text,
  bricked        boolean NOT NULL DEFAULT false,
  drop_id        bigint REFERENCES drops(id) ON DELETE SET NULL,
  before_item    jsonb,
  after_item     jsonb
);
CREATE INDEX slams_at ON slams (at);
