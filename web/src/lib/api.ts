import type { CharacterInfo, Drop, Item, StatsResponse } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.url.replace(location.origin, '')} failed: ${res.status}`);
  return res.json();
}

export interface Range {
  since: Date | null;
  until: Date | null;
}

export function rangeParams({ since, until }: Range) {
  const params = new URLSearchParams();
  if (since) params.set('since', since.toISOString());
  if (until) params.set('until', until.toISOString());
  return params;
}

export const fetchCharacters = async (): Promise<CharacterInfo[]> =>
  (await json<{ characters: CharacterInfo[] }>(await fetch('/api/characters'))).characters;

export async function fetchDrops(range: Range, includeIgnored = false): Promise<Drop[]> {
  const params = rangeParams(range);
  if (includeIgnored) params.set('ignored', 'include');
  return (await json<{ drops: Drop[] }>(await fetch(`/api/drops?${params}`))).drops;
}

export async function setDropIgnored(id: number, ignored: boolean) {
  await json(await fetch(`/api/drops/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ignored }) }));
}

/** Keep a craft (it counts as notable) or take that back. */
export async function setDropKept(id: number, kept: boolean) {
  await json(await fetch(`/api/drops/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kept }) }));
}

/** Pin a drop to haul card `slot` (null unpins), unpinning `unpin` (the slot's previous drops). */
export async function setDropPin(id: number, slot: number | null, unpin: number[] = []) {
  await json(
    await fetch(`/api/drops/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pinSlot: slot, unpin }) }),
  );
}

export interface SlamEntry {
  id: number;
  at: string;
  character: string | null;
  bricked: boolean;
  /** The find it changed, if it was one of yours. */
  drop_id: number | null;
  before_item: Item | null;
  after_item: Item | null;
}
export interface SlamStats {
  slams: number;
  bricked: number;
  list: SlamEntry[];
}
/** Slams (cube corruptions) in the range, and how many bricked. */
export const fetchSlams = async (range: Range): Promise<SlamStats> => json(await fetch(`/api/slams?${rangeParams(range)}`));

/** Items you still hold (stash or character): magic/rare/crafted finds, and stashed drops of any kind. */
export const fetchStashFinds = async (): Promise<Drop[]> => (await json<{ drops: Drop[] }>(await fetch('/api/stash-finds'))).drops;

export async function setDropStashed(id: number, stashed: boolean) {
  await json(await fetch(`/api/drops/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stashed }) }));
}

/** One character's stat readings (null: the first character), or every character's ('*'). */
export async function fetchStats(character: string | null): Promise<StatsResponse> {
  const params = new URLSearchParams();
  if (character === '*') params.set('all', '1');
  else if (character) params.set('character', character);
  return json(await fetch(`/api/stats?${params}`));
}

export interface SettingsView {
  account: string | null;
  characters: Record<string, boolean>;
  pollSeconds: number;
  /** Daily automatic backups kept (0 = off). */
  autoBackupKeep: number;
  hasToken: boolean;
  tokenHint: string | null;
  /** From the token's JWT `exp` claim, when readable. */
  tokenExpires: string | null;
}

export const fetchSettings = async (): Promise<SettingsView> => json(await fetch('/api/settings'));

export async function saveSettings(patch: Partial<Omit<SettingsView, 'hasToken' | 'tokenHint' | 'tokenExpires'>> & { token?: string }) {
  await json(await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }));
}

export interface SourceStatus {
  key: string;
  baseline_at: string | null;
  game_saved_at: string | null;
  last_poll_at: string | null;
  last_error: string | null;
}

export const fetchSources = async (): Promise<{ sources: SourceStatus[]; lastCycle: string | null; running: boolean }> =>
  json(await fetch('/api/sources'));
export const pollNow = async () => json(await fetch('/api/poll', { method: 'POST' }));
export const deleteSampleData = async () => json(await fetch('/api/sample-data', { method: 'DELETE' }));
export const seedSampleSeason = async (): Promise<Record<string, number | string>> => json(await fetch('/api/sample-data/season', { method: 'POST' }));

export interface Season {
  number: number;
  name: string;
  start: string;
  end: string | null;
}
export const fetchSeasons = async (): Promise<Season[]> => (await json<{ seasons: Season[] }>(await fetch('/api/seasons'))).seasons;

export const fetchHoldings = async (): Promise<Record<string, number>> =>
  (await json<{ holdings: Record<string, number> }>(await fetch('/api/holdings'))).holdings;

export interface GrailFound {
  quality: 'Unique' | 'Set';
  name: string;
  found_at: string;
  /** Marked as found by the player (a backfill), not a find the capture saw. */
  baseline: boolean;
  /** The drop that was the new find (null for a mark). */
  drop_id: number | null;
  /** Null for a mark. */
  item: Drop['item'] | null;
}
export const fetchGrail = async (range: Range = { since: null, until: null }): Promise<GrailFound[]> =>
  (await json<{ found: GrailFound[] }>(await fetch(`/api/grail?${rangeParams(range)}`))).found;

export const markGrail = async (quality: GrailFound['quality'], name: string, found: boolean) =>
  json(await fetch('/api/grail/mark', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quality, name, found }) }));

export interface Listing {
  id: string;
  item: Item;
  ladder: boolean;
  hardcore: boolean;
  /** Price as posted on the trade site, free text. */
  asking: string | null;
  asking_hr: number | null;
  listed_at: string;
  bumped_at: string | null;
  last_seen: string;
  /** Set once the listing is no longer on the trade site. */
  removed_at: string | null;
  outcome: 'sold' | 'unsold' | null;
  sold_hr: number | null;
  sold_price: string | null;
  closed_at: string | null;
  drop_id: number | null;
  found_at: string | null;
  character: string | null;
}

export interface ManualSale {
  id: string;
  sold_at: string;
  items: { code: string; qty: number }[];
  sold_hr: number;
  note: string | null;
}

/** Records a new sale, or with `id` rewrites that one. */
export async function saveManualSale(items: ManualSale['items'], soldHr: number, note: string, id?: string) {
  return json(
    await fetch(id ? `/api/manual-sales/${id}` : '/api/manual-sales', {
      method: id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items, soldHr, note }),
    }),
  );
}
export const deleteListing = async (id: string) => json(await fetch(`/api/listings/${id}`, { method: 'DELETE' }));
export const deleteManualSale = async (id: string) => json(await fetch(`/api/manual-sales/${id}`, { method: 'DELETE' }));

export const fetchListings = async (): Promise<{
  listings: Listing[];
  manualSales: ManualSale[];
  sync: { at: string; error: string | null } | null;
}> =>
  json(await fetch('/api/listings'));
export const syncListings = async () => json(await fetch('/api/listings/sync', { method: 'POST' }));
/** `delist` also removes the listing from the trade site (before recording anything). */
export async function closeListing(id: string, outcome: Listing['outcome'], soldHr?: number, soldPrice?: string, delist = false) {
  const res = await fetch(`/api/listings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ outcome, soldHr, soldPrice, delist }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `saving failed: ${res.status}`);
  return res.json();
}

/** Post a dropped item (it must be in the shared stash) on the PD2 trade site. */
export async function postListing(dropId: number, hrPrice: number, note: string): Promise<{ id: string }> {
  const res = await fetch('/api/listings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dropId: Number(dropId), hrPrice, note }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `posting failed: ${res.status}`);
  return res.json();
}

export interface BackupInfo {
  name: string;
  kind: 'manual' | 'auto' | 'safety' | 'update' | 'imported';
  size: number;
  createdAt: string;
}

export interface DatabaseInfo {
  bytes: number;
  tables: { name: string; rows: number; bytes: number }[];
  backupDir: string;
  backups: BackupInfo[];
}

export interface CharacterData {
  character: string;
  drops: number;
  stats: number;
  games: number;
  tracked: boolean;
  polled: boolean;
}

/** Throw the server's `{ error }` message (backups report what's wrong with a file). */
async function checked<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string; message?: string } | null)?.error ?? `${res.status}`);
  return res.json();
}

export const fetchDatabase = async (): Promise<DatabaseInfo> => json(await fetch('/api/database'));
export const compactDatabase = async (): Promise<{ before: number; after: number }> => checked(await fetch('/api/database/compact', { method: 'POST' }));
export const createBackup = async (): Promise<{ name: string }> => checked(await fetch('/api/backups', { method: 'POST' }));
export const importBackup = async (file: File): Promise<{ name: string }> =>
  checked(await fetch('/api/backups/import', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file }));
export const restoreBackup = async (name: string): Promise<{ restored: string; safety: string }> =>
  checked(await fetch(`/api/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' }));
export const deleteBackup = async (name: string) => checked(await fetch(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }));
export const backupUrl = (name: string) => `/api/backups/${encodeURIComponent(name)}`;

export const fetchCharacterData = async (): Promise<CharacterData[]> =>
  (await json<{ characters: CharacterData[] }>(await fetch('/api/data/characters'))).characters;
export const deleteCharacterData = async (name: string, untrack: boolean): Promise<{ removed: Record<string, number>; safety: string }> =>
  checked(await fetch(`/api/data/characters/${encodeURIComponent(name)}?untrack=${untrack}`, { method: 'DELETE' }));
