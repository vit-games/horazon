import { useEffect, useState, type ReactNode } from 'react';
import { ItemIcon } from '../components/ItemIcon';
import { SellForm } from '../components/SellForm';
import { Earnings } from '../components/Earnings';
import { ManualSaleForm } from '../components/ManualSaleForm';
import { TradeCharts, manualSaleTitle } from '../components/TradeCharts';
import { FloatingTooltip } from '../components/ItemTooltip';
import { closeListing, deleteListing, deleteManualSale, fetchListings, pollNow, setDropStashed, syncListings, type Listing, type ManualSale, type Range } from '../lib/api';
import { currencyItem } from '../lib/currencyCatalog';
import { listedDrops, playChime, useTradeReview } from '../lib/review';
import { useChanges } from '../lib/live';
import { GROUPS, GROUP_LABEL, itemGroup, itemKind, nameColor, type Group } from '../lib/itemStyle';
import { Summary } from '../components/Summary';
import { fmtHr } from '../lib/values';
import { listingStats } from '../lib/modShort';
import type { Drop, Item } from '../lib/types';
import { fieldSm as input, btnSm as button } from '../lib/ui';

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmt = (t: string) => dateFmt.format(new Date(t));


type HistoryEntry = { kind: 'listing'; t: string; listing: Listing } | { kind: 'manual'; t: string; sale: ManualSale };

const PAGE_SIZE = 15;

/** Long lists are shown a page at a time, with small previous/next controls under them. */
function Paged<T>({ items, onPage, children }: { items: T[]; onPage?: () => void; children: (page: T[]) => ReactNode }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const p = Math.min(page, pages - 1); // the list can shrink under us
  const go = (n: number) => {
    setPage(n);
    onPage?.();
  };
  return (
    <>
      {children(items.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE))}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 pt-2 text-xs text-muted">
          <span className="tabular-nums">
            {p * PAGE_SIZE + 1}–{Math.min(items.length, (p + 1) * PAGE_SIZE)} of {items.length}
          </span>
          <button className={button} disabled={p === 0} onClick={() => go(p - 1)}>
            ‹ Newer
          </button>
          <button className={button} disabled={p === pages - 1} onClick={() => go(p + 1)}>
            Older ›
          </button>
        </div>
      )}
    </>
  );
}

export function TradeView({ range }: { range: Range }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchListings>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingSale, setAddingSale] = useState(false);
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const version = useChanges('listings');
  const review = useTradeReview();

  useEffect(() => {
    fetchListings().then(setData, () => {});
  }, [version]);

  if (!data) return null;
  const { listings, manualSales, sync } = data;
  const pending = listings.filter((l) => l.removed_at && !l.outcome);
  const active = listings.filter((l) => !l.removed_at && !l.outcome);
  const sold = listings.filter((l) => l.outcome === 'sold');
  // Ended unsold: the item is back among the stashed ones (the To review section lists them).
  const unsoldAt = new Map(listings.flatMap((l) => (l.outcome === 'unsold' && l.drop_id !== null ? [[String(l.drop_id), l.closed_at ?? l.listed_at] as const] : [])));
  // Item sales and manual sales in one history, newest first.
  const history: HistoryEntry[] = [
    ...sold.map((listing) => ({ kind: 'listing' as const, t: listing.closed_at ?? listing.listed_at, listing })),
    ...manualSales.map((sale) => ({ kind: 'manual' as const, t: sale.sold_at, sale })),
  ].sort((a, b) => b.t.localeCompare(a.t));

  const rows = (list: Listing[]) => (
    <ul className="flex flex-col" onMouseLeave={() => setHover(null)}>
      {list.map((l) => (
        <ListingRow key={l.id} listing={l} onHover={(at) => setHover(at && { item: l.item, ...at })} />
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Earnings
          listings={listings}
          manualSales={manualSales}
          range={range}
          extra={[
            { value: active.length, label: 'on the trade site' },
            { value: <span className={pending.length ? 'text-accent' : ''}>{pending.length}</span>, label: pending.length === 1 ? 'needs a decision' : 'need a decision' },
          ]}
        />
        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          {sync?.error ? <span className="text-q-red">{sync.error}</span> : sync && <span>Listings synced {fmt(sync.at)}</span>}
          <button
            className={button}
            disabled={busy}
            title="Sync your trade-site listings and check your stash and characters (what you stashed, sold or moved in game)"
            onClick={() => {
              setBusy(true);
              // Both: the lists below come from the trade site and from your stash.
              Promise.allSettled([syncListings(), pollNow()]).finally(() => setBusy(false));
            }}
          >
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
          <button className={button} onClick={() => setAddingSale((a) => !a)}>
            Add manual sale
          </button>
        </div>
      </div>
      {addingSale && <ManualSaleForm onDone={() => setAddingSale(false)} />}

      <ReviewSection
        listed={listedDrops(listings)}
        unsoldAt={unsoldAt}
        onHover={(at, item) => setHover(at && item ? { item, ...at } : null)}
      />
      <TradeCharts listings={listings} manualSales={manualSales} range={range} />

      {listings.length === 0 && !manualSales.length && !review.toReview.length && (
        <p className="py-16 text-center text-muted">
          No listings yet. Items you post on the PD2 trade site show up here (synced every 5 minutes by account name).
        </p>
      )}
      {pending.length > 0 && <Section title="Gone from the trade site — did it sell?">{rows(pending)}</Section>}
      {active.length > 0 && <Section title="On the trade site">{rows(active)}</Section>}
      {history.length > 0 && (
        <Section title="Sale history">
          <Paged items={history} onPage={() => setHover(null)}>
            {(page) => (
              <ul className="flex flex-col" onMouseLeave={() => setHover(null)}>
                {page.map((e) =>
                  e.kind === 'listing' ? (
                    <ListingRow key={e.listing.id} listing={e.listing} onHover={(at) => setHover(at && { item: e.listing.item, ...at })} />
                  ) : (
                    <ManualSaleRow key={`m${e.sale.id}`} sale={e.sale} />
                  ),
                )}
              </ul>
            )}
          </Paged>
        </Section>
      )}
      {hover && <FloatingTooltip {...hover} />}
    </div>
  );
}

const KINDS_KEY = 'horazon.trade.kinds';

/**
 * Everything waiting for a decision, in one list: valuable drops once their stats are synced, and
 * the magic, rare and crafted items you found or made while they're in your stash or on a character.
 * Post them, or stash them. Stashed ones (and items whose listing ended unsold, back in your stash)
 * have their own view a click away, from where they go back to review or get sold. The kind line
 * filters either, as on Drops. Only the valuable drops chime and count on the rail: a pile of jewels shouldn't ring.
 */
function ReviewSection({
  listed,
  unsoldAt,
  onHover,
}: {
  listed: Set<string>;
  unsoldAt: Map<string, string>;
  onHover: (at: { x: number; y: number } | null, item?: Item) => void;
}) {
  const { toReview, finds, sound, setSound } = useTradeReview();
  const [selling, setSelling] = useState<string | null>(null);
  const [view, setView] = useState<'review' | 'stashed'>('review');
  const [kinds, setKinds] = useState<Group[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KINDS_KEY) ?? '[]') as Group[];
    } catch {
      return [];
    }
  });
  const pick = (next: Group[]) => {
    setKinds(next);
    try {
      localStorage.setItem(KINDS_KEY, JSON.stringify(next));
    } catch {
      // storage blocked: the filter lasts until reload
    }
  };

  const open = (d: Drop) => !listed.has(String(d.id));
  // The trade site only takes single items from the shared stash.
  const unpostable = (d: Drop) =>
    d.source === 'stack'
      ? "Stacked items can't be listed - record the sale with Add manual sale"
      : d.item.location?.storage && d.item.location.storage !== 'Shared Stash'
        ? 'Move it to your shared stash to list it'
        : null;
  // Stashed: only while it's in a stash now (stash-finds gives today's location), so what you sold,
  // dropped or took onto a character (a charm in use) leaves on its own; last stashed first.
  const inStash = (d: Drop) => d.item.location?.storage?.includes('Stash') ?? false;
  const stashed = finds.filter((d) => d.stashed_at && open(d) && inStash(d)).sort((a, b) => b.stashed_at!.localeCompare(a.stashed_at!));
  const all = view === 'review' ? toReview : stashed;

  const counts = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
  for (const d of all) counts[itemGroup(d.item)]++;
  // Empty kinds give way unless picked, as on Drops.
  const groups = GROUPS.filter((g) => counts[g] > 0 || kinds.includes(g));
  const shown = kinds.length ? all.filter((d) => kinds.includes(itemGroup(d.item))) : all;
  const note = (d: Drop) =>
    view === 'review'
      ? `${d.source === 'craft' ? 'Crafted' : 'Found'} ${fmt(d.found_at)}`
      : unsoldAt.has(String(d.id))
        ? `Listed, not sold ${fmt(unsoldAt.get(String(d.id))!)}`
        : `Stashed ${fmt(d.stashed_at!)}`;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-1">
        <h2 className="text-lg text-text">
          {view === 'review' ? 'To review' : 'Stashed'}
          {all.length > 0 && <span className={`font-num ${view === 'review' ? 'text-accent' : 'text-muted'}`}> {all.length}</span>}
        </h2>
        <span className="flex items-center gap-3 font-sans text-[13px] font-medium text-muted">
          {view === 'review' ? (
            <>
              <label className="flex items-center gap-1.5" title="A chime when a valuable drop joins the list (not magic, rare or crafted items)">
                <input type="checkbox" className="accent-accent" checked={sound} onChange={(e) => setSound(e.target.checked)} />
                Sound
              </label>
              <button type="button" className={button} onClick={playChime}>
                Test
              </button>
              {stashed.length > 0 && (
                <button type="button" className={button} onClick={() => setView('stashed')} title="Items you stashed, and ones whose listing ended unsold">
                  Stashed <span className="font-num tabular-nums">{stashed.length}</span>
                </button>
              )}
            </>
          ) : (
            <button type="button" className={button} onClick={() => setView('review')}>
              ‹ To review <span className="font-num tabular-nums">{toReview.length}</span>
            </button>
          )}
        </span>
      </div>
      {groups.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <Summary
            groups={groups}
            counts={counts}
            total={all.length}
            active={new Set(kinds)}
            onToggle={(g) => pick(kinds.includes(g) ? kinds.filter((k) => k !== g) : [...kinds, g])}
            onClear={() => pick([])}
          />
        </div>
      )}
      {all.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">
          {view === 'review'
            ? "Nothing to review. Drops you can sell show up here once their stats are synced from your stash or character: uniques, sets, runes and valuable currency with a sound, magic, rare and crafted finds while they're in your stash."
            : 'Nothing stashed.'}
        </p>
      ) : shown.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">
          Nothing {view === 'review' ? 'to review' : 'stashed'} among {kinds.map((k) => GROUP_LABEL[k].toLowerCase()).join(', ')}.{' '}
          <button className="text-accent hover:underline" onClick={() => pick([])}>
            Show all
          </button>
        </p>
      ) : (
        <Paged items={shown} onPage={() => onHover(null)}>
          {(page) => (
            <ul className="flex flex-col" onMouseLeave={() => onHover(null)}>
              {page.map((d) => (
                <li key={d.id} className="flex flex-col border-b border-line/50 px-3 py-1.5 hover:bg-panel-hi">
                  <div className="flex items-center gap-3" onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY }, d.item)} onMouseLeave={() => onHover(null)}>
                    <ItemIcon item={d.item} box={44} />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-[17px] font-semibold ${nameColor(d.item)}`}>{d.item.name}</div>
                      <div className="truncate text-xs text-muted">{[itemKind(d.item), listingStats(d.item), note(d), d.character].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="flex shrink-0 justify-end gap-1.5 sm:w-[200px]">
                      <span title={unpostable(d) ?? undefined}>
                        <button className={button} disabled={!!unpostable(d)} onClick={() => setSelling(selling === String(d.id) ? null : String(d.id))}>
                          Sell…
                        </button>
                      </span>
                      {view === 'review' ? (
                        <button className={button} title="Keep it for now - it waits under Stashed, from where it can come back" onClick={() => setDropStashed(d.id, true).catch(() => {})}>
                          Stash
                        </button>
                      ) : (
                        <button className={button} title="Put it back in the To review list" onClick={() => setDropStashed(d.id, false).catch(() => {})}>
                          Back to review
                        </button>
                      )}
                    </div>
                  </div>
                  {selling === String(d.id) && <SellForm dropId={d.id} item={d.item} onDone={() => setSelling(null)} />}
                </li>
              ))}
            </ul>
          )}
        </Paged>
      )}
    </section>
  );
}

function ManualSaleRow({ sale: m }: { sale: ManualSale }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex flex-col border-b border-line/50 px-3 py-1.5 hover:bg-panel-hi">
      <div className="flex items-center gap-3">
        <div className="flex w-11 shrink-0 flex-wrap items-center justify-center">
          {m.items.length ? (
            m.items.slice(0, 4).map((i) => <ItemIcon key={i.code} item={currencyItem(i.code)} box={m.items.length > 1 ? 22 : 44} />)
          ) : (
            <span className="text-xs text-muted">Service</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {/* Notes are the player's own words: they wrap rather than get cut off. */}
          <div className="text-[17px] font-semibold [overflow-wrap:anywhere] text-text">{m.items.length ? manualSaleTitle(m) : m.note}</div>
          <div className="text-xs [overflow-wrap:anywhere] text-muted">{[m.items.length ? m.note : null, `Sold ${fmt(m.sold_at)}`].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="w-16 shrink-0 text-right text-sm sm:w-28 text-q-normal tabular-nums">{fmtHr(m.sold_hr)}</div>
        <div className="flex shrink-0 justify-end gap-1.5 sm:w-[148px]">
          <button className="rounded-sm px-2 py-1 text-xs text-faint hover:bg-line hover:text-text" onClick={() => setEditing(!editing)}>
            Edit
          </button>
          <button
            className="rounded-sm px-2 py-1 text-xs text-muted hover:bg-q-red/10 hover:text-q-red"
            onClick={() => confirm(`Delete the sale "${m.items.length ? manualSaleTitle(m) : (m.note ?? 'Service')}" (${fmtHr(m.sold_hr)})?`) && void deleteManualSale(m.id).catch(() => {})}
          >
            Delete
          </button>
        </div>
      </div>
      {editing && <ManualSaleForm sale={m} onDone={() => setEditing(false)} />}
    </li>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 flex items-baseline justify-between border-b border-line pb-1 text-lg text-text">
        <span>{title}</span>
        {aside && <span className="font-num text-muted">{aside}</span>}
      </h2>
      {children}
    </section>
  );
}

function ListingRow({ listing: l, onHover }: { listing: Listing; onHover: (at: { x: number; y: number } | null) => void }) {
  const [form, setForm] = useState<'sold' | 'unsold' | null>(null);
  const toggle = (f: 'sold' | 'unsold') => setForm((cur) => (cur === f ? null : f));
  const qty = l.item.quantity ?? 1;

  const details = [
    // The player's own words only when they say more than the HR figure ("0.5 HR · 0.5" says it twice).
    (l.asking_hr !== null || l.asking) && `Asking ${[l.asking_hr !== null && fmtHr(l.asking_hr), l.asking && (l.asking_hr === null || isNaN(Number(l.asking))) && l.asking].filter(Boolean).join(' · ')}`,
    `Listed ${fmt(l.listed_at)}`,
    l.removed_at && `Gone ${fmt(l.removed_at)}`,
    l.character && `Found by ${l.character}`,
    !l.ladder && 'Non-ladder',
    l.hardcore && 'Hardcore',
  ].filter(Boolean);

  return (
    <li className={`flex flex-col border-b border-line/50 px-3 py-1.5 hover:bg-panel-hi ${l.outcome === 'unsold' ? '[&_img]:opacity-50' : ''}`}>
      <div className="flex items-center gap-3" onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY })} onMouseLeave={() => onHover(null)}>
        <ItemIcon item={l.item} box={44} />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[17px] font-semibold ${nameColor(l.item)}`}>
            {l.item.name}
            {qty > 1 && <span className="ml-1.5 text-sm font-normal text-text">×{qty}</span>}
          </div>
          <div className="truncate text-xs text-muted">{[itemKind(l.item), ...details].filter(Boolean).join(' · ')}</div>
        </div>
        {/* Fixed-width columns, rendered even when empty, so rows line up across all sections. */}
        <div className="w-16 shrink-0 text-right text-sm sm:w-28">
          {l.outcome === 'unsold' && <div className="text-muted">Unsold</div>}
          {l.outcome === 'sold' && (
            <>
              <div className="text-q-normal tabular-nums">{fmtHr(l.sold_hr!)}</div>
              {/* What was asked for, in the player's words, unless it only repeats the HR figure. */}
              {l.sold_price && Number(l.sold_price) !== l.sold_hr && (
                <div className="truncate text-xs text-muted" title={l.sold_price}>
                  {l.sold_price}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 justify-end sm:w-[148px] gap-1.5">
          {l.outcome === null ? (
            <>
              <button className={button} onClick={() => toggle('sold')}>
                Sold…
              </button>
              {/* Still on the site: confirm, with the option to take it down. */}
              <button className={button} onClick={() => (l.removed_at ? closeListing(l.id, 'unsold').catch(() => {}) : toggle('unsold'))}>
                {l.removed_at ? 'Not sold' : 'Not sold…'}
              </button>
            </>
          ) : (
            l.outcome === 'sold' && (
              // Rarely needed, so kept out of the way; the same pair as on manual sales.
              <>
                <button className="rounded-sm px-2 py-1 text-xs text-faint hover:bg-line hover:text-text" onClick={() => toggle('sold')}>
                  Edit
                </button>
                <button
                  className="rounded-sm px-2 py-1 text-xs text-muted hover:bg-q-red/10 hover:text-q-red"
                  onClick={() => confirm(`Delete the sale "${l.item.name}" (${fmtHr(l.sold_hr!)})?`) && void deleteListing(l.id).catch(() => {})}
                >
                  Delete
                </button>
              </>
            )
          )}
        </div>
      </div>
      {form === 'sold' && <SoldForm listing={l} onDone={() => setForm(null)} />}
      {form === 'unsold' && <UnsoldForm listing={l} onDone={() => setForm(null)} />}
    </li>
  );
}

/** Close a listing that is still on the trade site as not sold, optionally taking it down. */
function UnsoldForm({ listing: l, onDone }: { listing: Listing; onDone: () => void }) {
  const [delist, setDelist] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center justify-end gap-2 py-2 pl-[56px] text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        closeListing(l.id, 'unsold', undefined, undefined, delist).then(onDone, (err: Error) => {
          setError(err.message);
          setBusy(false);
        });
      }}
    >
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <input type="checkbox" className="accent-accent" checked={delist} onChange={(e) => setDelist(e.target.checked)} />
        Remove from trade site
      </label>
      <button className={button} disabled={busy}>
        {busy ? 'Saving…' : 'Mark not sold'}
      </button>
      <button type="button" className={button} onClick={onDone}>
        Cancel
      </button>
      {error && <div className="w-full text-right text-xs text-q-red">{error}</div>}
    </form>
  );
}

/** The final price is always typed and approved by hand: deals get renegotiated outside the site. */
function SoldForm({ listing: l, onDone }: { listing: Listing; onDone: () => void }) {
  // Sold at the asking price unless you change it.
  const [hr, setHr] = useState(String(l.sold_hr ?? l.asking_hr ?? ''));
  const onSite = !l.removed_at;
  const [delist, setDelist] = useState(onSite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(hr.replace(',', '.'));
  const valid = hr.trim() !== '' && Number.isFinite(value) && value >= 0;

  return (
    <form
      className="flex flex-wrap items-center gap-2 py-2 pl-[56px] text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        setError(null);
        closeListing(l.id, 'sold', value, l.sold_price ?? '', onSite && delist).then(onDone, (err: Error) => {
          setError(err.message);
          setBusy(false);
        });
      }}
    >
      <label className="flex items-center gap-1.5 text-muted">
        Final price
        <input className={`${input} w-24 text-text`} inputMode="decimal" autoFocus placeholder="0.5" onFocus={(e) => e.target.select()} value={hr} onChange={(e) => setHr(e.target.value)} />
        HR
      </label>
      {onSite && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" className="accent-accent" checked={delist} onChange={(e) => setDelist(e.target.checked)} />
          Remove from trade site
        </label>
      )}
      <button className={button} disabled={!valid || busy}>
        {busy ? 'Saving…' : 'Confirm sale'}
      </button>
      <button type="button" className={button} onClick={onDone}>
        Cancel
      </button>
      {error && <div className="w-full text-xs text-q-red">{error}</div>}
    </form>
  );
}
