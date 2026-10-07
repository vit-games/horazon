/**
 * Our listings on the projectdiablo2.com trade site. The market API is public and can be
 * filtered by `item.account_id`; listings simply vanish when removed or sold, so a vanished
 * listing is only marked `removed_at` and the user decides whether (and for how much) it sold.
 */
import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { notify } from './events.js';
import { stashModeOf } from './ingest.js';
import { createListing, deleteListing, type ApiItem } from './pd2api.js';
import { getSettings } from './settings.js';

const MARKET = 'https://api.projectdiablo2.com/market/listing';
const PAGE = 250; // the API's maximum $limit
const SYNC_MS = 5 * 60e3;

interface MarketListing {
  _id: string;
  type: string;
  is_ladder: boolean;
  is_hardcore: boolean;
  price?: string;
  hr_price?: number;
  item?: ApiItem & { hash?: string };
  created_at: string;
  bumped_at?: string;
}

let lastSync: { at: Date; error: string | null } | null = null;
export const listingSyncStatus = () => lastSync;

async function fetchListings(account: string): Promise<MarketListing[]> {
  const all: MarketListing[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const params = new URLSearchParams({ 'item.account_id': account, $limit: String(PAGE), $skip: String(skip) });
    const res = await fetch(`${MARKET}?${params}`, { headers: { 'user-agent': 'pd2-loot-tracker (personal, local)' } });
    if (!res.ok) throw new Error(`market listings: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { total: number; data: MarketListing[] };
    all.push(...body.data);
    if (body.data.length < PAGE || all.length >= body.total) return all;
  }
}

async function saveListing(db: PoolClient | typeof pool, l: MarketListing, dropId: number | null = null) {
  const item = l.item!;
  await db.query(
    `INSERT INTO listings (id, drop_id, item, name, base_code, quality, ladder, hardcore, asking, asking_hr, listed_at, bumped_at)
     VALUES ($1,
             COALESCE($13, (SELECT id FROM drops WHERE game_item_id = $2 OR item->>'hash' = $3 ORDER BY found_at DESC LIMIT 1)),
             $4, $5, $6, $7, $8, $9, $10, $11, $12, $14)
     ON CONFLICT (id) DO UPDATE SET
       item = EXCLUDED.item, asking = EXCLUDED.asking, asking_hr = EXCLUDED.asking_hr, bumped_at = EXCLUDED.bumped_at,
       drop_id = COALESCE(listings.drop_id, EXCLUDED.drop_id), last_seen = now(), removed_at = NULL`,
    [
      l._id, item.id ?? null, item.hash ?? null, item, item.name, item.base_code, item.quality?.name ?? '',
      l.is_ladder, l.is_hardcore, l.price || null, l.hr_price ?? null, l.created_at, dropId, l.bumped_at ?? null,
    ],
  );
}

export async function syncListings() {
  const { account } = await getSettings();
  if (!account) return;
  try {
    const listings = (await fetchListings(account)).filter((l) => l.item);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const l of listings) await saveListing(client, l);
      await client.query('UPDATE listings SET removed_at = now() WHERE removed_at IS NULL AND NOT (id = ANY($1))', [
        listings.map((l) => l._id),
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    lastSync = { at: new Date(), error: null };
  } catch (err) {
    lastSync = { at: new Date(), error: String((err as Error).message ?? err) };
  }
  notify('listings');
}

export async function getListings() {
  const { rows } = await pool.query(
    `SELECT l.id, l.item, l.ladder, l.hardcore, l.asking, l.asking_hr::float8 AS asking_hr, l.listed_at, l.bumped_at, l.last_seen, l.removed_at,
            l.outcome, l.sold_hr::float8 AS sold_hr, l.sold_price, l.closed_at, l.drop_id,
            d.found_at, d.character
       FROM listings l LEFT JOIN drops d ON d.id = l.drop_id
      ORDER BY COALESCE(l.closed_at, l.removed_at, l.listed_at) DESC`,
  );
  return rows;
}

/** Post a dropped item (must be in the shared stash) on the trade site and track the new listing. */
export async function postDrop(dropId: number, hrPrice: number, note: string) {
  const { account, token } = await getSettings();
  if (!token) throw new Error('Posting needs the projectdiablo2.com token (Settings)');
  const { rows } = await pool.query<{ item_id: number | null }>(`SELECT game_item_id AS item_id FROM drops WHERE id = $1`, [dropId]);
  const itemId = rows[0]?.item_id;
  if (!itemId) throw new Error('This drop has no item id (stacked currency cannot be listed)');
  const mode = await stashModeOf(Number(itemId));
  if (!mode) throw new Error('This item is not in your shared stash (only stash items can be listed)');
  const { ladder, hardcore } = mode;
  const created = (await createListing(account, token, { itemId: Number(itemId), hrPrice, note, ladder, hardcore })) as unknown as MarketListing;
  await saveListing(pool, { ...created, created_at: created.created_at ?? new Date().toISOString() }, dropId);
  notify('listings');
  return created._id;
}

/**
 * Record how a listing ended (`null` reopens it). A sale needs the approved final HR.
 * `delist` first takes it off the trade site; if that fails nothing is recorded.
 */
export async function closeListing(id: string, outcome: 'sold' | 'unsold' | null, soldHr: number | null, soldPrice: string | null, delist = false) {
  const sold = outcome === 'sold';
  if (delist) {
    const { token } = await getSettings();
    if (!token) throw new Error('Removing from the trade site needs the projectdiablo2.com token (Settings)');
    await deleteListing(token, id);
    await pool.query('UPDATE listings SET removed_at = now() WHERE id = $1 AND removed_at IS NULL', [id]);
  }
  await pool.query(
    `UPDATE listings SET outcome = $2, sold_hr = $3, sold_price = $4,
            closed_at = CASE WHEN $2::text IS NULL THEN NULL ELSE COALESCE(closed_at, now()) END
      WHERE id = $1`,
    [id, outcome, sold ? soldHr : null, sold ? soldPrice : null],
  );
  // Not sold: the item is back in your stash, so it joins the stashed ones (from where it can be sold again).
  if (outcome === 'unsold') {
    await pool.query('UPDATE drops SET stashed_at = COALESCE(stashed_at, now()) FROM listings l WHERE l.id = $1 AND drops.id = l.drop_id', [id]);
    notify('drops');
  }
  notify('listings');
}

/** Forget a listing (a sale recorded by mistake). One still on the trade site comes back on the next sync. */
export async function deleteListingRecord(id: string) {
  await pool.query('DELETE FROM listings WHERE id = $1', [id]);
  notify('listings');
}

export async function getManualSales() {
  const { rows } = await pool.query(
    'SELECT id, sold_at, items, sold_hr::float8 AS sold_hr, note FROM manual_sales ORDER BY sold_at DESC',
  );
  return rows;
}

export async function addManualSale(items: { code: string; qty: number }[], soldHr: number, note: string | null) {
  await pool.query('INSERT INTO manual_sales (items, sold_hr, note) VALUES ($1, $2, $3)', [JSON.stringify(items), soldHr, note]);
  notify('listings');
}

export async function updateManualSale(id: string, items: { code: string; qty: number }[], soldHr: number, note: string | null) {
  await pool.query('UPDATE manual_sales SET items = $2, sold_hr = $3, note = $4 WHERE id = $1', [id, JSON.stringify(items), soldHr, note]);
  notify('listings');
}

export async function deleteManualSale(id: string) {
  await pool.query('DELETE FROM manual_sales WHERE id = $1', [id]);
  notify('listings');
}

export function startListingSync() {
  const loop = async () => {
    await syncListings();
    setTimeout(loop, SYNC_MS);
  };
  void loop();
}
