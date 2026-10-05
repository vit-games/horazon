import { useMemo, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { FloatingTooltip } from './ItemTooltip';
import { NewMark } from './NewTag';
import { PinIcon } from './PinIcon';
import { GROUP_LABEL, itemGroup, itemKind, nameColor } from '../lib/itemStyle';
import { tierColor, tierLabel, tierOf, tiersOf, tierStyle } from '../lib/tiers';
import { isNotable, rankScore } from '../lib/rank';
import { runeNumber, runeTier } from '../lib/runes';
import { formatTime } from '../lib/time';
import { useValues } from '../lib/values';
import type { SlamStats } from '../lib/api';
import type { Drop, Item } from '../lib/types';

/** Low -> high key for the user's tier colours (names on hover). */
export function TierKey() {
  const config = tiersOf(useValues());
  const ranks = config.tiers.map((t, rank) => ({ t, rank })).reverse();
  return (
    <span className="flex items-center gap-2.5 font-num text-sm font-semibold tracking-[0.08em] text-muted uppercase">
      <span>Tier</span>
      <span>Low</span>
      <span className="flex gap-[3px]">
        {ranks.map(({ t, rank }) => (
          <span key={t.id} title={t.name} className="h-2.5 w-6.5" style={{ background: tierColor(config, rank) }} />
        ))}
      </span>
      <span>High</span>
    </span>
  );
}

/** Drag payload of a drop row (DropList), dropped on a haul card to pin it there. */
export const DROP_DRAG = 'application/x-horazon-drop';
/** Haul cards on the Drops page: one row of five, the second row on request. */
export const HAUL_SLOTS = 10;
const ROW = 5;
const WIDE_KEY = 'horazon.haul.both';
const SLOTS = Array.from({ length: HAUL_SLOTS }, (_, i) => i);

/**
 * The period's haul cards (compact, two rows of five): each shows the drop pinned to it in
 * this period (the latest pin), the rest fill with the best other drops. Pin by dragging a
 * drop row onto a card or with a row's pin button; the card's pin unpins / pins it in place.
 */
export function HaulHero({
  title,
  drops,
  newFinds,
  minRune,
  onPin,
  slams,
  onSlams,
  slamsOpen,
  scope,
}: {
  title: string;
  drops: Drop[];
  newFinds: Set<number>;
  minRune: number;
  onPin?: (drop: Drop, slot: number | null) => void;
  /** Slams in the period and how many bricked - a season's fun stat. */
  slams?: SlamStats | null;
  /** Toggle the slam list (the slam count is its switch). */
  onSlams?: () => void;
  slamsOpen?: boolean;
  /** Says which period the counts cover ("this season"), as the list below goes by day. */
  scope?: string;
}) {
  const values = useValues();
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [over, setOver] = useState<number | null>(null);
  // One row keeps the drop list near the top; the second row is a click away and remembered.
  const [both, setBoth] = useState(() => {
    try {
      return localStorage.getItem(WIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleBoth = () =>
    setBoth((b) => {
      try {
        localStorage.setItem(WIDE_KEY, b ? '0' : '1');
      } catch {
        // storage blocked: lasts until reload
      }
      return !b;
    });

  const slots = useMemo(() => {
    const pinned = SLOTS.map(
      (s) => drops.filter((d) => d.pin_slot === s).sort((a, b) => (b.pinned_at ?? '').localeCompare(a.pinned_at ?? ''))[0] ?? null,
    );
    const taken = new Set(pinned.filter(Boolean).map((d) => d!.id));
    const auto = drops
      .filter((d) => !taken.has(d.id))
      .map((d) => ({ d, tier: tierOf(d.item, values) }))
      // The shelf is the period's best: notable drops, and first-time grail finds (their sparkle says why).
      .filter(({ d, tier }) => isNotable(d, minRune, tier) || newFinds.has(d.id))
      .sort((a, b) => rankScore(b.d, newFinds, b.tier) - rankScore(a.d, newFinds, a.tier) || b.d.found_at.localeCompare(a.d.found_at));
    return pinned.map((d) => (d ? { d, tier: tierOf(d.item, values), pinned: true } : { ...(auto.shift() ?? { d: null, tier: null }), pinned: false }));
  }, [drops, values, newFinds, minRune]);

  // Counted like the toolbar's counts (quantities), so "N notable" matches "All N" without filters.
  const notableCount = drops.filter((d) => !d.ignored && isNotable(d, minRune, tierOf(d.item, values))).reduce((n, d) => n + d.quantity, 0);
  if (!slots.some((s) => s.d)) return null;

  const dropProps = (slot: number) =>
    onPin
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(DROP_DRAG)) return;
            e.preventDefault();
            setOver(slot);
          },
          onDragLeave: () => setOver(null),
          onDrop: (e: React.DragEvent) => {
            setOver(null);
            const id = e.dataTransfer.getData(DROP_DRAG);
            const d = drops.find((x) => String(x.id) === id); // ids are bigints: strings from the API
            if (d) onPin(d, slot);
          },
        }
      : {};

  return (
    <section className="flex flex-col gap-3.5" onMouseLeave={() => setHover(null)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-display text-5xl leading-none font-extrabold tracking-[0.02em] text-sigil uppercase">{title}</h2>
        <div className="flex flex-wrap items-center gap-5">
          <span className="text-lg font-semibold text-muted">
            {notableCount} notable{scope && ` ${scope}`}
            {newFinds.size > 0 && (
              <>
                {' · '}
                {/* The sparkle's key: every new-for-grail drop carries it. */}
                <NewMark size={15} className="mr-1 align-[-1px]" />
                {[...newFinds].filter((id) => drops.some((d) => d.id === id)).length} grail finds
              </>
            )}
          </span>
          {/* Slams are their own topic: a smaller line beside the haul count, not part of it. */}
          {slams && slams.slams > 0 && (
            <button
              className="text-sm text-muted underline decoration-line decoration-dotted underline-offset-4 hover:text-text"
              onClick={onSlams}
              aria-expanded={slamsOpen}
              title="Every cube corruption in the range picked at the top, and how many turned the item into a rare"
            >
              {`${slams.slams} slam${slams.slams === 1 ? '' : 's'}`}
              {slams.bricked > 0 && <span className="text-brick">{` · ${slams.bricked} bricked`}</span>}
            </button>
          )}
          {/* The tier key lives in the symbol key (?), with every other mark. */}
          <button className="text-sm text-accent hover:underline" onClick={toggleBoth} aria-expanded={both}>
            {both ? `Show ${ROW}` : `Show ${HAUL_SLOTS}`}
          </button>
        </div>
      </div>
      {/* Phones: one row that scrolls sideways, not five screens of cards. */}
      <div className="-mx-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5 [&>*]:w-40 [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-auto">
        {slots.slice(0, both ? HAUL_SLOTS : ROW).map(({ d, tier, pinned }, slot) => {
          if (!d) {
            return (
              <div
                key={`empty${slot}`}
                {...dropProps(slot)}
                className={`flex min-h-[176px] items-center justify-center border border-dashed px-3 text-center text-xs text-muted ${over === slot ? 'border-accent/70' : 'border-line'}`}
              >
                {onPin ? 'Drag a drop here to pin it' : ''}
              </div>
            );
          }
          const rune = runeNumber(d.item);
          const kind = rune !== null ? `${runeTier(rune)} rune #${rune}` : itemKind(d.item);
          // Items named after their base (Larzuk's Puzzlebox) would say their name twice: their tier or group instead.
          const sub = kind === d.item.name ? (tier ? tierLabel(tier) : GROUP_LABEL[itemGroup(d.item)]) : kind;
          return (
            <div
              key={d.id}
              style={tierStyle(tier)}
              {...dropProps(slot)}
              className={`group flex min-h-[176px] min-w-0 flex-col justify-between gap-1.5 border bg-panel px-3 pt-2.5 pb-3 ${tier ? 'tier-card' : ''} ${over === slot ? 'border-accent/70' : 'border-line'}`}
              onMouseMove={(e) => setHover({ item: d.item, x: e.clientX, y: e.clientY })}
            >
              <div className="flex min-h-5 items-start justify-between gap-1">
                {onPin ? (
                  <button
                    className={`flex items-center gap-1 text-xs ${pinned ? 'text-accent hover:text-text' : 'text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-text focus-visible:opacity-100'}`}
                    title={pinned ? 'Pinned here - click to unpin' : 'Pin this drop to this card'}
                    aria-label={pinned ? `Unpin ${d.item.name}` : `Pin ${d.item.name} to this card`}
                    onClick={() => onPin(d, pinned ? null : slot)}
                  >
                    <PinIcon filled={pinned} />
                    {!pinned && 'Pin'}
                  </button>
                ) : (
                  <span />
                )}
                {newFinds.has(d.id) && <NewMark size={18} />}
              </div>
              <div className={`flex h-[84px] items-center justify-center ${tier ? 'tier-glow' : ''}`}>
                <ItemIcon item={d.item} box={84} grow />
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className={`line-clamp-3 font-display text-base leading-tight font-extrabold uppercase ${nameColor(d.item)}`} title={d.item.name}>
                  {d.item.name}
                  {d.quantity > 1 && <span className="text-text"> ×{d.quantity}</span>}
                </span>
                <span className="text-xs text-muted" title={`${sub ? `${sub} · ` : ''}${formatTime(new Date(d.found_at))}${d.character ? ` · ${d.character}` : ''}`}>
                  {sub && `${sub} · `}
                  <span className="whitespace-nowrap">{formatTime(new Date(d.found_at))}</span>
                  {tier && <span className="sr-only">{` · ${tierLabel(tier)}`}</span>}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {hover && <FloatingTooltip {...hover} />}
    </section>
  );
}
