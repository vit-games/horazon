# Horazon — PD2 loot tracker

> [!WARNING]
> **Use Horazon at your own risk.** The Project Diablo 2 team has not confirmed that it is safe or allowed to use.
> PD2's rules forbid third-party software that interacts with the game, so using it may put your account at risk.
> Horazon is not affiliated with Project Diablo 2 or Blizzard.
> **It isn't detectable at this moment.** Since Horazon never touches the game process, its files or the PD2 servers,
  the game has nothing to detect it by, as far as I know today. That can change with any PD2 update, so it is not a
  promise that using it is safe or allowed.
> See [What Horazon does and doesn't do](#what-horazon-does-and-doesnt-do).

[![Downloads](https://img.shields.io/github/downloads/vit-games/horazon/total?style=for-the-badge&color=c9a45c)](https://github.com/vit-games/horazon/releases)
[![Latest release](https://img.shields.io/github/v/release/vit-games/horazon?include_prereleases&style=for-the-badge&color=c9a45c)](https://github.com/vit-games/horazon/releases/latest)
[![License](https://img.shields.io/github/license/vit-games/horazon?style=for-the-badge&color=c9a45c)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vithorn)

Desktop app that records Project Diablo 2 drops, grail progress and map runs as you play, with overlays for OBS.
Everything stays on your PC.

**Download and user guide: <https://vit-games.github.io/horazon/>**
(Windows installer and Linux AppImage, from [Releases](https://github.com/vit-games/horazon/releases)).

## What Horazon does and doesn't do

- **It doesn't modify the game in any way.** No injection, no reading or writing of the game's memory, no changes to
  game files, and it never sends anything to the PD2 servers. The game runs exactly as it would without Horazon.
- **It sees only what your game client sees.** Capture takes a passive copy of the traffic between your game client and
  the PD2 game server, on your own PC: the packets your client receives and sends, nothing more. Other connections on
  your PC are dropped as soon as their first bytes show they aren't a PD2 game connection; nothing from them is kept.
- **No login data is part of the capture.** Your account password is never seen (the realm login isn't read). Horazon
  keeps a recording of your last 40 games on your PC for troubleshooting capture; in those, your client's
  authentication packet and the game join's token are blanked, and recordings made by older versions are cleaned when
  capture starts.
- **Your data stays on your PC.** The only outside requests: the public PD2 armory and trade API
  (api.projectdiablo2.com) for your characters, and GitHub for update checks. The optional stash token (Setup → Stash)
  is something you paste in yourself; it is stored on your PC and sent only to projectdiablo2.com.

## Supporting the project

**Support [Project Diablo 2](https://www.projectdiablo2.com/) first and foremost.** PD2 is free, and the seasons, servers
and everything Horazon tracks exist because of its team and community. If you want to give something back, give it to
them first.

For Horazon itself, the most useful things are:

- **Report bugs and ideas** in [Issues](https://github.com/vit-games/horazon/issues): what you did, what you expected,
  and the app version (shown in the tray menu).
- **Tell others about it** if it's useful to you, and star the repository.
- **Buy me a coffee** on [Ko-fi](https://ko-fi.com/vithorn), if you'd like to, after PD2.

## How it fits together

- `desktop/` — Electron app (tray, game detection, capture control, kill counter window, auto-update). Runs the
  server in a utility process with an embedded PGlite database in the user data folder.
- `server/` — Fastify API + embedded PGlite; proxies and caches item art from projectdiablo2.com under `/pd2/*`.
- `web/` — React + Vite + Tailwind UI, served by the server.
- `capture/pd2capture.py` — reads the PD2 game connection (raw socket, no injection) and decodes the D2 game protocol:
  area changes, the map opened, the game's kill counter, ground drops, pickups, identifications and map event notices.
  Player chat is never forwarded. `server/src/capture.ts` turns that into games, area visits and map runs.
  `python3 capture/pd2capture.py replay file.pcap` prints the events of a recorded capture.
- `server/src/ingest.ts` — polls the public armory API for your characters and, with a pasted token, the shared stash.
  New item ids become drops; the first snapshot of each source is a baseline.
- `web/src/lib/tiers.ts` — item tiers (built-in default, edited on Drops → Tiers; stored in settings).
- Overlays (OBS Browser Sources): `/overlay` (drop feed), `/overlay/grail` (grail counter), `/overlay/moments`,
  `/overlay/session` (session scoreboard), `/killcounter` (run tracker; `?view=broadcast` for viewers). One built-in
  look; the Stream page builds each address with its options.
- `scripts/extract_game_data.py` — item image data from the PD2 site bundle into `web/src/data/game-data.json`. Re-run after PD2 patches.
- `site/` — the user guide on GitHub Pages (`.github/workflows/pages.yml`); `npm run site` previews it with live reload.

## Desktop app

```sh
npm install
npm run desktop           # build everything and start Electron from the repo
npm run dist              # build the installer (Windows) or AppImage (Linux) into desktop/release
```

Data lives in `~/.config/Horazon` / `%APPDATA%\Horazon` (`db/`, `backups/`, `config.json`) and is never part of
an install. Packaging: `desktop/scripts/stage.mjs` assembles `desktop/build/app` (compiled parts + runtime
dependencies pinned to the installed versions), `desktop/electron-builder.yml` packages it.

Capture permission:
- **Linux** — tray → *Grant capture permission…* copies the system `python3` to the data folder and gives the copy
  `cap_net_raw` through pkexec.
- **Windows** — the per-machine installer runs `desktop/windows/capture-task.ps1`, which registers an elevated scheduled
  task ("Horazon Capture") running the bundled embeddable Python, and a firewall rule. The app starts the task
  without a UAC prompt and controls it through `%ProgramData%\Horazon\capture` (`run.json` = port, `stop` flag);
  it logs to `%ProgramData%\Horazon\logs\capture.log`.

## Releasing

[github.com/vit-games/horazon](https://github.com/vit-games/horazon)
only receives releases, one commit each (no work history).

Version numbers follow the PD2 seasons:

| Bump | When | Example |
|---|---|---|
| **Major** (`X`.0.0) | A new PD2 season, with that season's feature upgrades | `1.0.0` for Alliance (Season 14) |
| **Minor** (x.`Y`.0) | Each new feature within a season | `1.1.0` |
| **Patch** (x.y.`Z`) | Fixes only | `1.1.1` |

Until then the app is a beta on `0.x`: `0.14.0` was the first public release, one minor version for each feature
added during the private betas. `1.0.0` comes with Alliance (Season 14, expected at the end of October 2026); its
PD2 beta period can get `1.0.0-beta.N` pre-releases. `2.0.0` is the season after.

1. Bump `version` in `desktop/package.json` (a suffix such as `-beta.1` makes a pre-release) and add its
   `## vX.Y.Z` section to `CHANGELOG.md`, commit.
2. `scripts/release.sh` — pushes this checkout's files as one commit on top of the previous release to the
   `github` remote (`git remote add github https://github.com/vit-games/horazon.git`) and tags it `vX.Y.Z`.
   `.github/workflows/release.yml` then builds the Windows installer and Linux AppImage on GitHub runners and
   publishes the release once both are built (a draft only while building; a failed build stays a draft).
   Installed apps see it within a few hours (or via tray → *Check for updates*). The release page is the download
   links plus the changelog section (`scripts/release-notes.mjs`; preview with `node scripts/release-notes.mjs X.Y.Z`).

Rules that keep users' data safe across updates:
- Migrations in `server/src/sql/` are append-only: never edit or rename a shipped one, add a new `NNN_*.sql`.
- Before installing an update the app writes an `update` backup; before applying new migrations the server writes another.
- An app older than the database (unknown migrations) refuses to start instead of writing to it.
- `@electric-sql/pglite` is pinned to an exact version: a PGlite release with a new Postgres major can't open the old
  data folder. Upgrading it needs a migration path (export a backup with the old engine, restore into the new one).
- Backups are engine-independent JSON (`server/src/backup.ts`) and restore into any newer version.

The installers are not code-signed: Windows SmartScreen warns on first run (*More info → Run anyway*).

## Develop

```sh
npm install
npm run dev               # API on :8080, UI on http://localhost:5173
```

The dev server keeps its PGlite database in `.dev-db/` (delete it to start fresh). For game capture during development, run
`python3 capture/pd2capture.py live --post http://127.0.0.1:8080/api/capture/events` with `CAP_NET_RAW` (or as
Administrator on Windows). `npm run dev` uses POSIX shell syntax (`HOST=… tsx …`), so on Windows run it from WSL or
Git Bash (`npm config set script-shell "C:\\Program Files\\git\\bin\\bash.exe"`).

Characters of captured games are tracked automatically; add others and the shared-stash token under **Settings**.
Demo data: **Settings → Sample data**.
