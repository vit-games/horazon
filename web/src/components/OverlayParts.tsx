import { ItemIcon } from './ItemIcon';
import { NewMark } from './NewTag';
import { asItem } from '../lib/capture';
import { corruption } from '../lib/corruption';
import { currencyLabel, WORLDSTONE_CODES, type CurrencyStack } from '../lib/currencyDrops';
import type { GrailFound } from '../lib/api';
import { grailCounts } from '../lib/grail';
import { facetRoll, nameColor, torchRoll } from '../lib/itemStyle';
import { ClassIcon } from './ClassIcon';
import { tierStyle, type TierInfo } from '../lib/tiers';
import type { FeedDay } from '../lib/useLiveDrops';
import type { Drop } from '../lib/types';

/**
 * Uniques and sets found, each on its own line in the game's quality colour. `large` is the
 * standalone grail counter: the found count is its one giant figure.
 */
export function GrailPanel({ grail, large = false }: { grail: GrailFound[]; large?: boolean }) {
  const c = grailCounts(grail);
  const rows = [
    { label: 'Uniques', color: 'var(--color-q-unique)', ...c.Unique },
    { label: 'Sets', color: 'var(--color-q-set)', ...c.Set },
  ];
  return (
    <div className={`ov-slab ov-pad flex flex-col ${large ? 'gap-4' : 'gap-2'}`}>
      {large && <h2 className="font-display text-xl leading-none font-bold text-sigil ov-ink">Grail</h2>}
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 ov-ink">
            <span className={`font-semibold tracking-[0.04em] ${large ? 'text-lg' : 'text-[17px]'}`} style={{ color: r.color }}>
              {r.label}
            </span>
            <span className="font-num leading-none font-bold text-text tabular-nums">
              <span className={large ? 'text-[40px]' : 'text-[22px]'}>{r.have}</span>
              <span className={`text-muted ${large ? 'text-lg' : 'text-[17px]'}`}> / {r.total}</span>
            </span>
          </div>
          <div className={`ov-track rounded-full ${large ? 'h-2' : 'h-1.5'}`}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0.5, (r.have / r.total) * 100))}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });

/**
 * One drop: tier stripe and tint, the art, the name in its quality colour (wrapping to a second
 * line rather than cut off), the white-gold sparkle when it was new for the grail, what a
 * corruption gave, and the time.
 */
export function FeedRow({ d, tier, isNew, fresh }: { d: Drop; tier: TierInfo | null; isNew: boolean; fresh: boolean }) {
  const slam = corruption(d.item);
  const facet = facetRoll(d.item);
  const torch = torchRoll(d.item);
  return (
    <li style={tierStyle(tier)} className={`ov-rule flex min-h-12 items-center gap-3 border-t py-1.5 pr-4 pl-4 ${tier ? 'tier-row' : ''} ${fresh ? 'ov-new' : ''}`}>
      <ItemIcon item={d.item} box={36} />
      <span className="flex min-w-0 flex-1 flex-col justify-center ov-ink">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`line-clamp-2 text-[19px] leading-[22px] font-semibold ${nameColor(d.item)}`}>
            {d.item.name}
            {d.quantity > 1 && <span className="text-text"> ×{d.quantity}</span>}
          </span>
          {facet && (
            <span className="shrink-0 font-num text-[17px] font-semibold whitespace-nowrap tabular-nums" style={{ color: facet.color }} title={facet.title}>
              {facet.dmg} / {facet.pierce}
            </span>
          )}
          {torch && (
            // Class icon, then Vitality / Energy / All Res / Light Radius, as facets show their two rolls.
            <span className="flex shrink-0 items-center gap-1 font-num text-[17px] font-semibold whitespace-nowrap text-text tabular-nums" title={torch.title}>
              {torch.cls && <ClassIcon cls={torch.cls} size={16} />}
              {[torch.vit, torch.ene, torch.res, torch.light].map((v) => v ?? '–').join(' / ')}
            </span>
          )}
          {isNew && <NewMark size={16} />}
        </span>
        {slam !== null && <span className="truncate text-[15px] leading-[18px] font-semibold text-q-red">{slam || 'Corrupted'}</span>}
      </span>
      <span className="shrink-0 font-num text-[17px] font-semibold whitespace-nowrap text-muted tabular-nums ov-ink">{timeFmt.format(new Date(d.found_at))}</span>
    </li>
  );
}

/**
 * A day's currency on one line: icon (and name for runes) per kind, its count from 2 up, a tier
 * glow behind the art. With `shards`, the Worldstone Shard count leads the line - 0 included.
 */
function CurrencyRow({ stacks, shards }: { stacks: CurrencyStack[]; shards: CurrencyStack[] | null }) {
  return (
    <div className="ov-rule flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t px-4 py-2 ov-ink">
      {shards && <ShardCounter shards={shards} />}
      {stacks.map((s) => (
        <span key={s.code} className="flex items-center gap-1">
          {/* A tiered stack: the tier's light behind its art, as on haul cards and moments. */}
          <span className={s.tier ? 'tier-glow-sm' : ''} style={tierStyle(s.tier)}>
            <ItemIcon item={s.item} box={28} />
          </span>
          {/^r\d\d/.test(s.code) && <span className={`text-[17px] font-semibold ${nameColor(s.item)}`}>{currencyLabel(s.item)}</span>}
          {s.count > 1 && <span className="font-num text-[17px] font-semibold text-muted">×{s.count}</span>}
        </span>
      ))}
    </div>
  );
}

const SHARD_ITEMS = [...WORLDSTONE_CODES].map((code) => asItem({ code, quality: null, uid: null }));

/** Worldstone (and, once found, Tainted Worldstone) Shards picked up that day (the `shards` toggle). */
function ShardCounter({ shards }: { shards: CurrencyStack[] }) {
  return (
    <>
      {SHARD_ITEMS.map((item) => {
        const n = shards.find((s) => s.code === item.base_code)?.count ?? 0;
        if (!n && item.base_code !== 'wss') return null;
        return (
          <span key={item.base_code} className="flex items-center gap-1" title={item.name}>
            <ItemIcon item={item} box={28} />
            <span className="font-num text-[17px] font-semibold text-muted">×{n}</span>
          </span>
        );
      })}
    </>
  );
}

/**
 * A day of drops ("Today", "Yesterday", weekday): its title and count, then the drops, then the
 * currency line. A day with nothing notable is its title line alone, not a panel saying so.
 */
export function FeedPanel({
  day,
  index,
  newFinds,
  tiers,
  fresh,
  label,
  showCurrency = true,
  showShards = false,
}: {
  day: FeedDay;
  index: number;
  newFinds: Set<number>;
  tiers: Map<number, TierInfo | null>;
  fresh: Set<number>;
  label?: string;
  showCurrency?: boolean;
  showShards?: boolean;
}) {
  const currency = showCurrency ? day.currency : [];
  const empty = day.top.length === 0 && currency.length === 0 && !showShards;
  return (
    <section className="ov-slab flex flex-col">
      <header className="flex items-baseline justify-between gap-3 px-4 py-2 ov-ink">
        <h2 className="font-display text-xl leading-tight font-bold text-text">
          {label ?? (index === 0 ? 'Today' : index === 1 ? 'Yesterday' : dayFmt.format(day.start))}
        </h2>
        <span className="font-num text-[17px] font-medium text-muted tabular-nums">{empty ? 'nothing notable yet' : day.count > 0 ? `${day.count} notable` : ''}</span>
      </header>
      {!empty && (
        <>
          <ul>
            {day.top.map((d) => (
              <FeedRow key={d.id} d={d} tier={tiers.get(d.id) ?? null} isNew={newFinds.has(d.id)} fresh={fresh.has(d.id)} />
            ))}
          </ul>
          {(currency.length > 0 || showShards) && <CurrencyRow stacks={currency} shards={showShards ? day.shards : null} />}
        </>
      )}
    </section>
  );
}
