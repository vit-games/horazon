/** Minimal client for api.projectdiablo2.com. */
import io from 'socket.io-client';

const API = 'https://api.projectdiablo2.com';

export interface ApiItem {
  id: number;
  name: string;
  base_code: string;
  is_simple: boolean;
  is_identified?: boolean;
  quality: { id: number; name: string };
  base?: { name: string; type?: string; type_code?: string; stackable?: boolean };
  quantity?: number;
  location?: { storage?: string; equipment?: string | null; stash_page?: number };
  /** Runes/jewels/gems inside this item's sockets (not listed at top level). */
  socketed?: ApiItem[];
  [key: string]: unknown;
}

export interface CharacterResponse {
  file: { updated_at: number };
  character: {
    name: string;
    level: number;
    class: { name: string };
    status: { is_hardcore: boolean; is_ladder: boolean; is_dead: boolean };
  };
  mercenary?: { items?: ApiItem[] };
  items: ApiItem[];
}

export interface StashResponse {
  file?: { updated_at?: number };
  currency?: {
    runes?: Record<string, number>;
    gems?: Record<'flawless' | 'perfect', Record<string, number>>;
  };
  items: ApiItem[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string, token?: string | null): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      'user-agent': 'pd2-loot-tracker (personal, local)',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new ApiError(res.status, `${path}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** Public armory data: inventory, equipment, personal stash of one character. */
export const fetchCharacter = (name: string) => get<CharacterResponse>(`/game/character/${encodeURIComponent(name)}`);

// pd2-trade types the stash payload as a [null, data] tuple; accept both shapes.
const unwrapStash = (res: StashResponse | [null, StashResponse]) =>
  Array.isArray(res) ? (res.find((x) => x && Array.isArray((x as StashResponse).items)) as StashResponse) : res;

export interface StashResult {
  stash: StashResponse;
  /** Account name from the session (when the site token was used). */
  account: string | null;
  /** Token re-issued by the session login, to keep the stored one fresh. */
  refreshedToken: string | null;
}

type SessionUser = { _id?: string; game?: { characters_by_account?: Record<string, unknown> } };
type SocketCall = <T>(method: string, ...args: unknown[]) => Promise<T>;

/**
 * The website's token (localStorage `pd2-token`) is a session JWT the site only uses
 * over its socket.io (v2) connection: it logs the socket in via `security/session`
 * with the "jwt" strategy and then calls services on that socket. We do the same.
 */
function withSession<T>(token: string, label: string, run: (call: SocketCall, session: { accessToken?: string; user?: SessionUser }) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = io(API, { transports: ['websocket'], upgrade: false, reconnection: false, timeout: 15_000 });
    const done = (fn: () => void) => {
      clearTimeout(timer);
      socket.close();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error(`${label}: timed out`))), 30_000);
    const call: SocketCall = (method, ...args) =>
      new Promise((res, rej) =>
        socket.emit(method, ...args, (err: { code?: number; message?: string } | null, data: never) =>
          err ? rej(new ApiError(err.code ?? 500, `${args[0]}: ${err.message ?? 'error'}`)) : res(data),
        ),
      );

    socket.on('connect_error', (e: Error) => done(() => reject(new Error(`${label}: ${e.message}`))));
    socket.on('connect', async () => {
      try {
        const session = await call<{ accessToken?: string; user?: SessionUser }>('create', 'security/session', { strategy: 'jwt', accessToken: token }, {});
        const result = await run(call, session);
        done(() => resolve(result));
      } catch (err) {
        done(() => reject(err));
      }
    });
  });
}

const sessionAccount = (session: { user?: SessionUser }, account: string | null) => {
  const accounts = Object.keys(session.user?.game?.characters_by_account ?? {});
  const acc = account ?? accounts[0] ?? null;
  if (!acc) throw new Error('No PD2 account found for this login');
  return accounts.find((a) => a.toLowerCase() === acc.toLowerCase()) ?? acc;
};

function fetchStashOverSocket(account: string | null, token: string, ladder: boolean, hardcore: boolean): Promise<StashResult> {
  return withSession(token, 'stash socket', async (call, session) => {
    const acc = sessionAccount(session, account);
    const query = { account: acc, softcore: !hardcore, ladder };
    const stash = unwrapStash(await call<StashResponse | [null, StashResponse]>('get', 'game/stash', acc, query));
    return { stash, account: acc, refreshedToken: session.accessToken && session.accessToken !== token ? session.accessToken : null };
  });
}

/** Take one of our listings off the trade site (DELETE market/listing/:id, as pd2-trade does). */
export function deleteListing(token: string, listingId: string) {
  return withSession(token, 'market listing', (call) => call('remove', 'market/listing', listingId, {}));
}

export interface NewListing {
  itemId: number;
  hrPrice: number;
  note: string;
  ladder: boolean;
  hardcore: boolean;
}

/**
 * Post a shared-stash item on the trade site, the way pd2-trade does (POST market/listing):
 * the item is sent exactly as the stash API returns it, so it is re-read from the stash first.
 */
export function createListing(account: string | null, token: string, l: NewListing) {
  return withSession(token, 'market listing', async (call, session) => {
    const acc = sessionAccount(session, account);
    if (!session.user?._id) throw new Error('The login did not return a user id');
    const query = { account: acc, softcore: !l.hardcore, ladder: l.ladder };
    const stash = unwrapStash(await call<StashResponse | [null, StashResponse]>('get', 'game/stash', acc, query));
    const item = stash.items.find((i) => i.id === l.itemId);
    if (!item) throw new Error('That item is not in your shared stash (only stash items can be listed)');
    return call<{ _id: string } & Record<string, unknown>>('create', 'market/listing', {
      user_id: session.user._id,
      type: 'item',
      is_hardcore: l.hardcore,
      is_ladder: l.ladder,
      item: { ...item, account_id: acc.toLowerCase() },
      hr_price: l.hrPrice,
      price: l.note,
      bumped_at: new Date().toISOString(),
    }, {});
  });
}

let stashViaSocket = false;

/**
 * Shared stash. OAuth tokens (like pd2-trade's) work as a REST Bearer header; the
 * website's own session token only works over the socket - try REST, fall back.
 */
export async function fetchStash(account: string | null, token: string, ladder: boolean, hardcore: boolean): Promise<StashResult> {
  if (!stashViaSocket && account) {
    try {
      const params = new URLSearchParams({ account, softcore: String(!hardcore), ladder: String(ladder) });
      const res = await get<StashResponse | [null, StashResponse]>(`/game/stash/${encodeURIComponent(account)}?${params}`, token);
      return { stash: unwrapStash(res), account, refreshedToken: null };
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
  }
  const result = await fetchStashOverSocket(account, token, ladder, hardcore);
  stashViaSocket = true;
  return result;
}

export interface SeasonResponse {
  name: string;
  start: string;
}

export const fetchSeason = (n?: number) => get<SeasonResponse>(`/game/season${n ? `?season=${n}` : ''}`);
