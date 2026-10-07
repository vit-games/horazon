import { Fragment, useMemo, useRef, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { FloatingTooltip } from './ItemTooltip';
import { facetRoll, itemGroup, itemKind, nameColor, torchRoll } from '../lib/itemStyle';
import { ClassIcon } from './ClassIcon';
import { runeNumber, runeTier } from '../lib/runes';
import { dayLabel, formatTime } from '../lib/time';
import { tierLabel, tierOf, tierStyle } from '../lib/tiers';
import { fmtHr, useValues } from '../lib/values';
import { corruption, isBricked, isCorrupted } from '../lib/corruption';
import { bases } from '../lib/grail';
import { currencyLabel, isCurrency, stackCurrency } from '../lib/currencyDrops';
import { DROP_DRAG, HAUL_SLOTS } from './HaulHero';
import { DayCalendar } from './DayCalendar';
import { NewMark } from './NewTag';
import { Pager } from './Pager';
import { PinIcon } from './PinIcon';
import { SellForm } from './SellForm';
import type { Drop, Item } from '../lib/types';

/** A drop's trade state: on the trade site, or sold for `hr`. */
export interface DropTrade {
  sold: boolean;
  hr?: number;
}


const QUALITY_WORD: Record<string, string> = { magic: 'Magic', rare: 'Rare', unique: 'Unique', set: 'Set', crafted: 'Crafted' };
/** "from Rare Amulet + Hitpower Craft Infusion": what a cube recipe used (source 'craft'). */
function craftedFrom(item: Item): string | null {
  const inputs = (item as Item & { crafted_from?: { code: string; quality?: string | null }[] }).crafted_from;
  if (!inputs?.length) return null;
  return `from ${inputs.map((i) => [QUALITY_WORD[i.quality ?? ''], bases[i.code]?.name ?? i.code].filter(Boolean).join(' ')).join(' + ')}`;
}

function subtitle(item: Item): string {
  const group = itemGroup(item);
  if (group === 'Gem') return group;
  const rune = runeNumber(item);
  if (rune !== null) return `${runeTier(rune)} rune · #${rune}`;
  // Sockets from a corruption show with it instead.
  const corruptSockets = corruption(item) === `${item.socket_count} OS`;
  const extras = [item.is_ethereal && 'Eth', item.socket_count > 0 && !corruptSockets && `${item.socket_count} OS`].filter(Boolean);
  return [itemKind(item), ...extras, craftedFrom(item)].filter(Boolean).join(' · ');
}

/** A Rainbow Facet's element and rolls: "Poison 5 / 4" is +5% poison damage, -4% enemy poison resistance. */
export function FacetRoll({ item }: { item: Item }) {
  const f = facetRoll(item);
  if (!f) return null;
  return (
    <span className="font-semibold" style={{ color: f.color }} title={f.title}>
      {` · ${f.label} ${f.dmg} / ${f.pierce}`}
    </span>
  );
}

/** A Hellfire Torch's rolls: "Amazon +2 · 34 Vit · 16 Ene · 12 Res · 5 LR", the class with its icon. */
export function TorchRoll({ item }: { item: Item }) {
  const t = torchRoll(item);
  if (!t) return null;
  const stats = [t.vit !== null && `${t.vit} Vit`, t.ene !== null && `${t.ene} Ene`, t.res !== null && `${t.res} Res`, t.light !== null && `${t.light} LR`].filter(Boolean);
  return (
    <span className="font-semibold text-text" title={t.title}>
      {' · '}
      {t.cls && (
        <>
          <ClassIcon cls={t.cls} size={13} className="mr-0.5 inline-block align-[-2px]" />
          {t.cls}
          {t.skills !== null && ` +${t.skills}`}
          {stats.length > 0 && ' · '}
        </>
      )}
      {stats.join(' · ')}
    </span>
  );
}

/** A day's currency as one strip: a chip per kind with its count, tier-coloured. */
function CurrencyStrip({
  drops,
  each,
  onToggle,
  onHover,
}: {
  drops: Drop[];
  each: boolean;
  onToggle: () => void;
  onHover: (h: { item: Item; x: number; y: number } | null) => void;
}) {
  const values = useValues();
  const stacks = stackCurrency(drops, (d) => tierOf(d.item, values));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line/50 px-3 py-2 text-sm">
      <span className="text-muted">Currency</span>
      {stacks.map((s) => (
        <span
          key={s.code}
          className="flex cursor-default items-center gap-1"
          onMouseMove={(e) => onHover({ item: s.item, x: e.clientX, y: e.clientY })}
          onMouseLeave={() => onHover(null)}
        >
          <ItemIcon item={s.item} box={24} />
          <span className={nameColor(s.item)}>{currencyLabel(s.item)}</span>
          {s.count > 1 && (
            <span className="text-muted tabular-nums" style={s.tier ? { color: s.tier.color } : undefined}>
              ×{s.count}
            </span>
          )}
        </span>
      ))}
      <span className="ml-auto flex items-center gap-3 text-xs text-muted">
        <button className="hover:text-text" onClick={onToggle} title={each ? 'Back to one strip' : 'Show each currency drop as a row'}>
          {each ? 'Group' : 'Show each'}
        </button>
      </span>
    </div>
  );
}

/**
 * A bricked find's row, split in half: what it was (as found or crafted) → what the slam made
 * of it, each with its own tooltip, and the brick badge between them.
 */
function BrickedSplit({ drop: d, onHover }: { drop: Drop; onHover: (h: { item: Item; x: number; y: number } | null) => void }) {
  const half = (item: Item, sub: string) => (
    <div
      className="flex min-w-0 flex-1 items-center gap-3"
      onMouseMove={(e) => {
        e.stopPropagation();
        onHover({ item, x: e.clientX, y: e.clientY });
      }}
    >
      <ItemIcon item={item} box={44} />
      <div className="min-w-0">
        <div className={`truncate text-[17px] font-semibold ${nameColor(item)}`}>{item.name}</div>
        <div className="truncate text-xs text-muted">{sub}</div>
      </div>
    </div>
  );
  const before = d.original_item!;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {half(before, [itemKind(before), craftedFrom(d.item)].filter(Boolean).join(' · '))}
      <span
        className="flex shrink-0 flex-col items-center text-xs font-semibold text-brick"
        title={d.item_updated_at ? `Bricked ${new Date(d.item_updated_at).toLocaleString()}` : 'Bricked'}
      >
        <span aria-hidden className="text-lg leading-none">→</span>
        bricked
      </span>
      {half(d.item, itemKind(d.item))}
    </div>
  );
}

/** " (was Crafted Ring)": the item before it changed, its tooltip on hover instead of the row's. */
function WasItem({ item, onHover }: { item: Item; onHover: (h: { item: Item; x: number; y: number } | null) => void }) {
  return (
    <span
      className="cursor-help underline decoration-dotted underline-offset-2"
      onMouseMove={(e) => {
        e.stopPropagation();
        onHover({ item, x: e.clientX, y: e.clientY });
      }}
    >
      {` (was ${item.name})`}
    </span>
  );
}

/** Drops listed per page within a day. */
const DAY_PAGE = 25;
const dayBtn = 'min-w-8 rounded-sm border border-line px-2.5 py-0.5 text-base text-muted hover:text-text disabled:border-line/50 disabled:text-faint disabled:hover:text-faint';

/** Pin a drop to one of the haul cards (a pinned drop shows its card; click unpins). */
function PinButton({ drop, onPin, onEnter }: { drop: Drop; onPin: (d: Drop, slot: number | null) => void; onEnter: () => void }) {
  // The row's item tooltip follows the mouse; keep it off the slot picker.
  const quiet = { onMouseEnter: onEnter, onMouseMove: (e: React.MouseEvent) => e.stopPropagation() };
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const slot = drop.pin_slot ?? null;
  // Keyboard: the first card takes focus on open, Esc closes and returns to the pin.
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  if (slot !== null) {
    return (
      <button
        {...quiet}
        className="flex w-16 shrink-0 items-center justify-center gap-1 text-xs text-accent hover:text-text max-sm:hidden"
        title={`Pinned to haul card ${slot + 1} - click to unpin`}
        aria-label={`${drop.item.name}, pinned to haul card ${slot + 1}: unpin`}
        onClick={() => onPin(drop, null)}
      >
        <PinIcon filled />
        Card {slot + 1}
      </button>
    );
  }
  return (
    <span {...quiet} className="relative flex w-16 shrink-0 justify-center max-sm:hidden" onMouseLeave={() => setOpen(false)}>
      {open ? (
        <span
          role="group"
          aria-label={`Pin ${drop.item.name} to a haul card`}
          className="absolute inset-y-0 right-0 z-10 my-auto grid h-fit w-max grid-cols-5 gap-0.5 rounded-sm border border-line bg-panel p-1 shadow-lg"
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close())}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}
        >
          {Array.from({ length: HAUL_SLOTS }, (_, s) => s).map((s) => (
            <button
              key={s}
              className="h-5 w-6 rounded-sm border border-line text-xs leading-none text-muted tabular-nums hover:border-accent/60 hover:text-text"
              title={`Pin to haul card ${s + 1}`}
              aria-label={`Haul card ${s + 1}`}
              autoFocus={s === 0}
              onClick={() => (close(), onPin(drop, s))}
            >
              {s + 1}
            </button>
          ))}
        </span>
      ) : (
        <button
          ref={trigger}
          className="text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-text focus-visible:opacity-100"
          title="Pin to one of the haul cards at the top (or drag the row onto a card)"
          aria-label={`Pin ${drop.item.name} to a haul card`}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <PinIcon />
        </button>
      )}
    </span>
  );
}

export function DropList({
  drops,
  onIgnore,
  onKeep,
  newFinds,
  trade,
  onPin,
  aside,
  toolbar,
  counted,
  unit,
}: {
  drops: Drop[];
  /** The page's filters, pinned together with the day heading while the list scrolls under them. */
  toolbar?: React.ReactNode;
  /** Which rows a day's count counts (listed-but-uncounted rows aside), and what it calls them. */
  counted?: (d: Drop) => boolean;
  unit?: [string, string];
  /** Right after the day picker (the Drops page puts its Show select there). */
  aside?: React.ReactNode;
  onIgnore?: (d: Drop, ignored: boolean) => void;
  /** Keep a craft (notable) or take it back; with `onIgnore`, undecided crafts get Keep / Discard. */
  onKeep?: (d: Drop, kept: boolean) => void;
  /** Drop ids that were a new grail find. */
  newFinds?: Set<number>;
  /** Trade state by drop id (listed on the trade site, or sold); when given, rows get a "Sell…" action. */
  trade?: Map<string, DropTrade>;
  /** Pin to a haul card (0-based, null unpins); when given, rows get a pin button and drag onto the cards. */
  onPin?: (d: Drop, slot: number | null) => void;
}) {
  const [selling, setSelling] = useState<number | null>(null);
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const values = useValues();

  const [listEach, setListEach] = useState<Set<string>>(new Set());
  const [day, setDay] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  // Days with drops, newest first: local date key, "Today"-style label, the drops.
  const days = useMemo(() => {
    const map = new Map<string, { key: string; label: string; list: Drop[] }>();
    for (const d of drops) {
      const at = new Date(d.found_at);
      const key = at.toLocaleDateString('sv');
      const entry = map.get(key) ?? { key, label: dayLabel(at), list: [] };
      entry.list.push(d);
      map.set(key, entry);
    }
    return [...map.values()];
  }, [drops]);
  // Named next to the count, so "2 notable" over five rows adds up.
  const uncounted = (list: Drop[]) => {
    if (!counted) return undefined;
    const out = list.filter((d) => !d.ignored && !counted(d));
    const grail = out.filter((d) => newFinds?.has(d.id)).length;
    const crafts = out.length - grail;
    return [grail && `${grail} grail find${grail === 1 ? '' : 's'}`, crafts && `${crafts} craft${crafts === 1 ? '' : 's'} to judge`].filter(Boolean).join(' · ') || undefined;
  };

  if (drops.length === 0) {
    return (
      <div className="flex flex-col gap-2">
      {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      {aside && <div className="flex">{aside}</div>}
      <p className="border-t border-line py-3 text-sm text-muted">
        No drops in this period. Drops are recorded as you play; to look around first, add a sample season in{' '}
        <a href="#setup" className="text-accent hover:underline">
          Setup
        </a>
        .
      </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" onMouseLeave={() => setHover(null)}>
      {(() => {
        // One day at a time (newest first), in pages. Currency reads better as one strip per day;
        // "Show each" brings its rows back (for their actions).
        const dayAt = Math.max(0, days.findIndex((x) => x.key === day));
        const { key: label, list } = days[dayAt];
        const currency = list.filter((d) => isCurrency(d.item));
        const each = listEach.has(label);
        const allRows = each ? list : list.filter((d) => !isCurrency(d.item));
        const pages = Math.max(1, Math.ceil(allRows.length / DAY_PAGE));
        const at = Math.min(page, pages - 1);
        const rows = allRows.slice(at * DAY_PAGE, (at + 1) * DAY_PAGE);
        const go = (i: number) => {
          setDay(days[i].key);
          setPage(0);
          setHover(null);
        };
        return (
        <section key={label}>
          {/* One pinned block: what you filter by, then which day you're on and what it shows. */}
          <div className="z-10 -mt-2 flex flex-col gap-4 bg-bg pt-2 md:sticky md:top-0">
          {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
          {/* The heading is the day alone; its controls sit beside it, not inside it. */}
          <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-1 text-base font-semibold text-text">
            <h2 className="sr-only">{days[dayAt].label}</h2>
            <span className="flex items-center gap-1.5">
              {/* Older on the left, newer on the right, as on a calendar (the list itself runs newest first). */}
              <button className={dayBtn} disabled={dayAt === days.length - 1} onClick={() => go(dayAt + 1)} title="Older day (←)" aria-label="Older day" data-hotkey-day="older">
                ‹
              </button>
              <DayCalendar
                days={days.map((x) => ({ key: x.key, label: x.label, count: x.list.filter((d) => !counted || counted(d)).reduce((n, d) => n + d.quantity, 0), also: uncounted(x.list) }))}
                unit={unit}
                value={label}
                onPick={(k) => go(days.findIndex((x) => x.key === k))}
              />
              <button className={dayBtn} disabled={dayAt === 0} onClick={() => go(dayAt - 1)} title="Newer day (→)" aria-label="Newer day" data-hotkey-day="newer">
                ›
              </button>
            </span>
            {aside}
          </div>
          </div>
          {currency.length > 0 && (
            <CurrencyStrip
              drops={currency}
              each={each}
              onToggle={() => setListEach((s) => (s.has(label) ? new Set([...s].filter((x) => x !== label)) : new Set([...s, label])))}
              onHover={setHover}
            />
          )}
          <ul className="flex flex-col">
            {rows.map((d) => {
              const tier = tierOf(d.item, values);
              const traded = trade?.get(String(d.id));
              const sellable = trade && !traded && !!d.item.id && !d.ignored && d.source !== 'sample';
              // A craft nobody judged yet: muted, with Keep / Discard instead of "Not a drop".
              const craft = !!onKeep && d.source === 'craft' && !tier && !d.ignored;
              const undecided = craft && !d.kept;
              return (
              <Fragment key={d.id}>
              <li
                draggable={!!onPin}
                onDragStart={(e) => e.dataTransfer.setData(DROP_DRAG, String(d.id))}
                style={tierStyle(tier)}
                tabIndex={0}
                className={`group flex cursor-default items-center gap-3 border-b border-line/50 px-3 py-1.5 hover:bg-panel-hi focus-visible:bg-panel-hi ${tier ? 'tier-row' : ''} ${d.ignored ? 'ignored-row' : ''}`}
                onMouseMove={(e) => setHover({ item: d.item, x: e.clientX, y: e.clientY })}
                onFocus={(e) => {
                  if (e.target !== e.currentTarget) return; // a button inside the row
                  const r = e.currentTarget.getBoundingClientRect();
                  setHover({ item: d.item, x: r.left + Math.min(r.width / 2, 420), y: r.top + r.height / 2 });
                }}
                onBlur={() => setHover(null)}
              >
                {isBricked(d.item, d.original_item) && d.original_item ? (
                  <BrickedSplit drop={d} onHover={setHover} />
                ) : (
                <>
                <div className={`shrink-0 ${undecided ? 'opacity-60' : ''}`}>
                  <ItemIcon item={d.item} box={44} />
                </div>
                <div className={`min-w-0 flex-1 ${undecided ? 'opacity-60' : ''}`}>
                  <div
                    className={`truncate text-[17px] font-semibold ${nameColor(d.item)}`}
                    title={d.source === 'craft' ? 'Made with a cube recipe - yours, not a drop' : undefined}
                  >
                    {d.item.name}
                    {d.quantity > 1 && <span className="ml-1.5 text-sm font-normal text-text">×{d.quantity}</span>}
                    {newFinds?.has(d.id) && <NewMark size={16} className="ml-2 align-[-1px]" />}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {subtitle(d.item)}
                    <FacetRoll item={d.item} />
                    <TorchRoll item={d.item} />
                    {/* The stripe's tier in words: read out always, shown on hover and focus. */}
                    {tier && (
                      <span className="sr-only group-hover:not-sr-only group-focus-visible:not-sr-only">{` · ${tierLabel(tier)}`}</span>
                    )}
                    {(() => {
                      if (isBricked(d.item, d.original_item)) {
                        return (
                          <span className="font-semibold text-brick" title={d.item_updated_at ? `Bricked ${new Date(d.item_updated_at).toLocaleString()}` : undefined}>
                            {' · Bricked'}
                            {d.original_item && <WasItem item={d.original_item} onHover={setHover} />}
                          </span>
                        );
                      }
                      const outcome = corruption(d.item);
                      if (outcome === null) return null;
                      // Slammed after it dropped: when, and what it was if it turned into another item.
                      const slammed = d.original_item && !isCorrupted(d.original_item);
                      return (
                        <span
                          className="text-q-red"
                          title={slammed && d.item_updated_at ? `Slammed ${new Date(d.item_updated_at).toLocaleString()}` : undefined}
                        >
                          {' · Corrupted'}
                          {outcome && `: ${outcome}`}
                          {slammed && d.item.name !== d.original_item!.name && <WasItem item={d.original_item!} onHover={setHover} />}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                </>
                )}
                <div className="w-20 shrink-0 text-right text-xs text-muted">
                  <div className="tabular-nums">{formatTime(new Date(d.found_at))}</div>
                  {d.character && <div className="truncate">{d.character}</div>}
                  {traded && (
                    <a href="#trade" className="block truncate text-accent hover:underline" title="On the Trade page">
                      {traded.sold ? `Sold ${fmtHr(traded.hr!)}` : 'Listed'}
                    </a>
                  )}
                </div>
                {/* A hidden drop can't hold a haul card: its column stays, empty. */}
                {onPin && (d.ignored ? <span className="w-16 shrink-0 max-sm:hidden" /> : <PinButton drop={d} onPin={onPin} onEnter={() => setHover(null)} />)}
                {/* Rendered on every row (hidden where it doesn't apply) so the columns stay aligned. */}
                {trade && (
                  <button
                    className={`w-12 shrink-0 rounded-sm border border-line py-0.5 text-xs text-muted hover:border-accent/50 hover:text-text max-sm:hidden ${sellable ? '' : 'invisible'}`}
                    disabled={!sellable}
                    title="Post on the PD2 trade site (item must be in your shared stash)"
                    onClick={() => setSelling(selling === d.id ? null : d.id)}
                  >
                    Sell…
                  </button>
                )}
                {undecided && onIgnore ? (
                  <div className="flex w-20 shrink-0 flex-col gap-1 max-sm:hidden">
                    <button
                      className="rounded-sm border border-accent/60 bg-accent/15 py-0.5 text-xs text-text hover:bg-accent/25"
                      title="Worth keeping: counts as a notable drop"
                      aria-label={`Keep ${d.item.name}`}
                      onClick={() => onKeep!(d, true)}
                    >
                      Keep
                    </button>
                    <button className="rounded-sm py-0.5 text-xs text-muted hover:bg-line hover:text-text" title="A bad roll: hide it" aria-label={`Discard ${d.item.name}`} onClick={() => onIgnore(d, true)}>
                      Discard
                    </button>
                  </div>
                ) : craft && d.kept ? (
                  // A control, so it looks like one: undo is the click, not a hidden title.
                  <button
                    className="w-20 shrink-0 rounded-sm border border-line py-0.5 text-xs text-muted max-sm:hidden hover:border-accent/50 hover:text-text"
                    title="Kept as notable. Click to undo"
                    aria-label={`${d.item.name} kept as notable: undo`}
                    onClick={() => onKeep!(d, false)}
                  >
                    Kept · undo
                  </button>
                ) : onIgnore && (
                  <button
                    className="w-20 shrink-0 rounded-sm py-0.5 text-xs text-muted opacity-0 max-sm:hidden group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-line hover:text-text focus-visible:opacity-100"
                    title={d.ignored ? 'Count this drop again' : 'Not a drop (traded in, cubed, …) — hide it'}
                    aria-label={d.ignored ? `Restore ${d.item.name}` : `${d.item.name} is not a drop: hide it`}
                    onClick={() => onIgnore(d, !d.ignored)}
                  >
                    {d.ignored ? 'Restore' : 'Not a drop'}
                  </button>
                )}
              </li>
              {selling === d.id && <SellForm dropId={d.id} item={d.item} onDone={() => setSelling(null)} />}
              </Fragment>
              );
            })}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
              <span className="tabular-nums">
                {at * DAY_PAGE + 1}–{Math.min(allRows.length, (at + 1) * DAY_PAGE)} of {allRows.length}
              </span>
              <Pager
                page={at}
                pages={pages}
                onPage={(p) => {
                  setPage(p);
                  setHover(null);
                }}
              />
            </div>
          )}
        </section>
        );
      })()}
      {hover && <FloatingTooltip {...hover} />}
    </div>
  );
}
