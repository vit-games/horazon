#!/usr/bin/env node
// The release page for a version: download links, a few notes, then that version's section
// of CHANGELOG.md with the release date.
//   node scripts/release-notes.mjs 0.1.0-beta.1 [--date 2026-10-03]   (prints the page)
//   node scripts/release-notes.mjs 0.1.0-beta.1 --check                (exit 1 without a section)
import { readFileSync } from 'node:fs';

const REPO = 'https://github.com/vit-games/horazon';
const args = process.argv.slice(2);
const version = args[0]?.replace(/^v/, '');
if (!version) {
  console.error('usage: release-notes.mjs <version> [--date YYYY-MM-DD] [--check]');
  process.exit(2);
}

/** The changes listed under `## v<version>`, up to the next `## ` heading. */
function section(text, v) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## v${v}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  return body || null;
}

const changes = section(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), version);
if (args.includes('--check')) {
  if (!changes) console.error(`CHANGELOG.md has no "## v${version}" section with changes`);
  process.exit(changes ? 0 : 1);
}
if (!changes) {
  console.error(`CHANGELOG.md has no "## v${version}" section with changes`);
  process.exit(1);
}

const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
const date = dateArg ? new Date(`${dateArg}T12:00:00Z`) : new Date();
const day = date.getUTCDate();
const ordinal = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
const when = `${date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${day}${ordinal}, ${date.getUTCFullYear()}`;
const download = `${REPO}/releases/download/v${version}`;

process.stdout.write(`## Download

### [[CLICK HERE FOR WINDOWS DOWNLOAD]](${download}/Horazon-Setup-${version}.exe)

### [[CLICK HERE FOR LINUX (APPIMAGE) DOWNLOAD]](${download}/Horazon-${version}-x86_64.AppImage)

Already installed? Horazon updates itself: tray → *Check for updates*, or it does so on its own within a few hours.

**NOTE:** the Windows installer isn't code-signed, so SmartScreen warns on first run: *More info → Run anyway*.
On Linux, grant the capture permission once from the tray (*Grant capture permission…*).

**NOTE:** start Horazon before you join a game, so it sees the whole game.

Setup and user guide: https://vit-games.github.io/horazon/

### v${version} - ${when}

${changes}

**Please report bugs and ideas in [Issues](${REPO}/issues) - and support [Project Diablo 2](https://www.projectdiablo2.com/) first and foremost!**
`);
