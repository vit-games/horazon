# Changelog

One section per release, newest first: `## vX.Y.Z` followed by its changes. The release page
is built from the section of its version (`scripts/release-notes.mjs`, which also adds the
date and download links), and `scripts/release.sh` refuses a version without one.

Versions follow the PD2 seasons: major for a new season (with its feature upgrades), minor for
each new feature, patch for fixes (see the README's Releasing section).

## v0.15.0

#### NEW

- **Listing notes write themselves** - Sell… fills the note buyers see with your price and the item's stats, as
  torch listings read ("0.25 HR (+16 AR / 14-34 Fire)"): every stat of a magic, rare or crafted item, only the rolls
  of a unique or set; prices under 0.2 HR read in Worldstone Shards (0.05 HR is "5 WSS"). Type in it to write
  your own. Quick prices (0.05 to 2 HR) sit next to the price box.
- **Stats on Trade rows** - each item under To review and Stashed shows the same short stats, so jewels and charms
  can be told apart without hovering.
- **Sell… only where it can work** - stacked items and items not in your shared stash can't be listed, and the
  button now says so instead of failing after you typed a price.
- **Edit and Delete on every sale** - each sale in the history now has both: currency and service sales can be
  edited instead of deleted and entered again, and an item sale recorded by mistake can be deleted.

- **Treacherous maps** - a map with a player ear used on it gets its own mark (an ear) next to the corrupted,
  Heroic, Catalyzed and Fortified marks.

- **The grail counts what you find in game** - a unique or set joins the grail when you find it during a game, no
  longer because a stash sync saw it (traded or muled items counted too). Earlier finds can be marked by hand: hover
  an item on the Grail tab and pick Mark found. Items that counted as "owned at start" need marking again.

- **Your runes as a stash page on Drops → Currency** - the two rune strips are now one grid of all 33 runes, El to
  Zod as the game's rune stash lays them out, each with the count you own now (every character and the shared
  stash; runes you have none of stay empty). Pick a rune to track it and higher; the rune tracker and the gaps
  between finds follow right under it. Currency comes last, as one narrower table of what you found and when (the Horadric items joined it;
  the per-map rate is gone, as most currency doesn't come from maps).

#### FIXES

- **Stashed lists only what's in a stash** - an item you took onto a character (a charm you're using) left a greyed-out
  Sell… behind; it now leaves the list until it's back in a stash. Sell… also goes by where the item is now, not
  where it was found.
- **The Trade badge matches To review** - the rail counted only new valuable drops while To review also held your
  magic, rare and crafted stash finds; both now show the same number.
- **Confirming a sale asks only for the final price** - it starts at your asking price, so a sale at that price is
  one Enter; the "what you got" box is gone.
- **No comma decimals when listing** - the Sell… price box took "0,1" as 0.1 HR, so a slip between , and . could post an
  item far too cheap; it now asks for a dot.
- **Skill bonuses read by their kind** - "+1 to Summoning Skills (Necromancer Only)" is "+1 Summoning", a single
  skill "+3 Critical Strike"; damage, thorns, absorb and max-resist stats got proper short names too.

- **The shared stash of the mode you play** - with a ladder and a non-ladder character both checked, the stash was
  read for whichever was checked last, so ladder stash finds were missing from Trade (and Sell… posted in that
  mode). Each mode's shared stash is now read on its own, and an item is listed in the mode of the stash it's in.
- **Rainbow Facets named** - a facet identified in game was recorded as an unidentified Jewel (with its stats) and
  missed the grail; facets are named now, and the ones already recorded are fixed when you update.

- **Unique maps named on the overlays** - the run tracker and Moments showed a unique map as "T5 Map"; they now
  show its name (Zhar's Sanctum...), without a tier, as the rest of the app does.

- **Sync now on Trade checks your stash too** - it synced only your trade-site listings, so items you sold or moved
  in game stayed under Stashed until the next item check; it now does both.

## v0.14.0

The first public release. Horazon reads the game's network traffic while you play (nothing injected, nothing read
from the game process, nothing sent to the PD2 servers) and keeps everything on your PC. There is nothing to do
while you play.

#### WHAT'S IN IT

- **Session** - the open map's name, tier, clock, kills, share cleared and how you stand against your best clear;
  between maps, the last run and the session so far: the best find, the other drops, how each map went against
  your best, and every map, zone and boss fight, each a link to the run on the Runs page.
- **Session history** - under the session, the season's totals and every earlier session (a run of games without a
  break longer than 45 minutes) with its maps, zones and boss fights, kills, best find and who played; open one to
  see it as it ended. A calendar shows when you play, and your best drop days and first high runes.
- **Experience** - how far into your level you are, what the session added, what deaths cost and, while you play,
  when you reach the next level at this pace. A Shadow of Mendeln event shows the experience his undead gave.
- **Runs** - every map run with its tier, density, boss kill, clear time, kills, kills per minute, share cleared,
  map events and notable drops. *By map* compares your maps (runs, best and typical clear, trend); *Log* lists runs
  with filters by tier, map, event, monsters, character and corruption.
- **What was used on a map** - corrupted, Heroic (a Standard of Heroes), Catalyzed (a Catalyst Shard) and Fortified
  maps are marked on their runs, read from the map itself.
- **Map events** - Shadow of Mendeln, Horazon, Treasure Fallen, invaders, the Altar of the Catalyst and Gheed are
  recognised by what they bring into the map, with what they gave.
- **Zones** - runs outside maps (corrupted zones, act bosses, farming spots), one row per zone, opening to its runs
  and what each found.
- **Bossing** - uber fights are recorded: Lucion, Rathma and Mendeln, Diablo Clone, Uber Tristram and the Uber
  Ancients, with the tier read from the summon item. A fight is one summon, rejoins included, with its kill time,
  deaths, the entries used and, when the boss lived, how far you got.
- **Kills that match `.kills`** - every monster that dies in your game counts, as the game's `.kills` counts them;
  summons, traps and monster-cast hydras don't. Deaths and time played come from your games too.
- **Characters** - switch between them, or see *All* of them together and compare them. Non-ladder characters are
  recognised from the game and kept out of a season's totals.
- **Drops** - ten haul cards for the season's best drops, ranked by your item tiers; pin any drop to a card. Below,
  one day at a time on a calendar shaded by drops, filtered by kind. Runes, keys, essences and the like are counted
  per day. Rainbow Facets and Hellfire Torches show their rolls.
- **Item tiers** - your own tier list: drag items between tiers, select several and move them together, find items
  inside the tiers by the names players use (shako, soj, griffs...), put an item's eth and non-eth versions in
  different tiers. Every change saves itself and Undo takes it back; export and import a tier list.
- **Slams and crafts** - cube slams and bricks are counted per season with before → after; crafted items are
  recorded with what went into them.
- **Grail** - every unique and set, found or missing, all time or by season, with first finds marked as they drop
  and milestones. Boss-only items count when found but aren't needed for 100%; unique maps don't count.
- **Trade** - one list of what you could sell: valuable drops once their stats are synced, and the magic, rare and
  crafted items in your stash, filtered by kind. Sell or stash each; stashed items wait under *Stashed* while you
  still hold them. Listings you post on the PD2 trade site sync back, and you mark them sold with the price you got.
  No market prices or estimates: only the prices you enter.
- **Overlays for OBS** - run tracker (viewer and pilot versions, also following boss fights live), moments, drop
  feed, grail counter and a session scoreboard. The Stream page builds each address with a preview. The pilot run
  tracker can also sit above the game.
- **Updates in the app** - a new version shows in the status line, to restart now or later; *What's new* opens once
  after updating.
- **Safe data** - a backup every day, before every update and before the database changes; restore any of them
  from Setup. Recordings of your games stay on your PC and keep no login data.
