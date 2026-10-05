import { pool } from './db.js';

export interface Settings {
  /** Bearer token from projectdiablo2.com, needed only for the shared stash. */
  token: string | null;
  /** PD2 account name (the shared stash endpoint is per account). */
  account: string | null;
  /** Characters to poll via the public character API, name -> enabled. */
  characters: Record<string, boolean>;
  pollSeconds: number;
  /** Daily automatic backups to keep (0 = no automatic backups). */
  autoBackupKeep: number;
  /** The user's item tiers (web/src/lib/tiers.ts), best first; null = the built-in default. */
  tiers: TierConfig | null;
}

export interface TierConfig {
  tiers: { id: string; name: string; color: string | null; entries: { kind: 'unique' | 'set' | 'base'; key: string; eth?: boolean }[] }[];
}

const DEFAULTS: Settings = { token: null, account: null, characters: {}, pollSeconds: 60, autoBackupKeep: 7, tiers: null };

/** A well-formed tier config, cleaned of anything else, or null. */
export function parseTierConfig(value: unknown): TierConfig | null {
  const tiers = (value as { tiers?: unknown } | null)?.tiers;
  if (!Array.isArray(tiers) || tiers.length > 30) return null;
  const out: TierConfig['tiers'] = [];
  for (const t of tiers as Record<string, unknown>[]) {
    if (!t || typeof t.id !== 'string' || typeof t.name !== 'string' || !Array.isArray(t.entries) || t.entries.length > 3000) return null;
    const color = typeof t.color === 'string' && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : null;
    const entries: TierConfig['tiers'][number]['entries'] = [];
    for (const e of t.entries as Record<string, unknown>[]) {
      if (!e || !['unique', 'set', 'base'].includes(e.kind as string) || typeof e.key !== 'string' || e.key.length > 80) return null;
      entries.push({ kind: e.kind as 'unique' | 'set' | 'base', key: e.key, ...(typeof e.eth === 'boolean' ? { eth: e.eth } : {}) });
    }
    out.push({ id: t.id.slice(0, 40), name: t.name.trim().slice(0, 40) || 'Tier', color, entries });
  }
  return { tiers: out };
}

export async function getSettings(): Promise<Settings> {
  const { rows } = await pool.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULTS, ...stored } as Settings;
}

export async function updateSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    );
  }
}

export async function getCache<T>(key: string): Promise<{ value: T; updated_at: Date } | null> {
  const { rows } = await pool.query('SELECT value, updated_at FROM cache WHERE key = $1', [key]);
  return rows[0] ?? null;
}

export async function setCache(key: string, value: unknown) {
  await pool.query(
    `INSERT INTO cache (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
