import { FeedPanel, GrailPanel } from '../components/OverlayParts';
import { PUL, RUNE_NAMES } from '../lib/runes';
import { useOverlayPage } from '../lib/overlay';
import { useLiveDrops } from '../lib/useLiveDrops';
/**
 * Drop overlay (OBS Browser Source): each day's top drops (compact rows with what a corruption gave,
 * tier colors). Grail progress is the grail counter's job (/overlay/grail), not repeated here.
 * Everything is configured through the URL so it can live in OBS without clicks:
 *   days      how many days to show, newest first        (1-7, default 1)
 *   count     top drops per day                          (1-10, default 5)
 *   min       lowest rune that counts, by name           (default Pul)
 *   dayStart  hour a "day" starts, for late sessions     (0-23, default 6)
 *   layout    column | row                               (default column)
 *   scale     size multiplier                            (0.5-3, default 1)
 *   character only this character's drops                (default all)
 *   empty     hide -> render nothing on days without notable drops
 *   only      tiered -> show only drops in your item tiers (Drops -> Tiers), colour-coded
 *             ("mystery", its old name, still works)
 *   currency  hide -> no currency row (runes, keys, essences... counted per day, under the items)
 *   shards    1 -> Worldstone Shard count leading each day's currency row (0 included)
 *   grail     all | season | off: drops that were a new grail find in that scope get a small
 *             sparkle (default all; off = no sparkle)
 *   sample    1 -> made-up drops and grail (the Stream tab's preview), nothing fetched
 */
export interface OverlayOptions {
  days: number;
  count: number;
  min: number;
  dayStart: number;
  layout: 'column' | 'row';
  scale: number;
  character: string;
  hideEmpty: boolean;
  grail: 'all' | 'season' | 'off';
  onlyTiered: boolean;
  showCurrency: boolean;
  showShards: boolean;
  sample: boolean;
}

const clamp = (n: number, lo: number, hi: number, fallback: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

export function parseOverlayOptions(search: string): OverlayOptions {
  const p = new URLSearchParams(search);
  const num = (k: string) => (p.has(k) ? Number(p.get(k)) : NaN);
  const minName = p.get('min');
  const minIdx = minName ? RUNE_NAMES.findIndex((r) => r.toLowerCase() === minName.toLowerCase()) : -1;
  return {
    days: clamp(num('days'), 1, 7, 1),
    count: clamp(num('count'), 1, 10, 5),
    min: minIdx >= 0 ? minIdx + 1 : PUL,
    dayStart: clamp(num('dayStart'), 0, 23, 6),
    layout: p.get('layout') === 'row' ? 'row' : 'column',
    scale: clamp(num('scale'), 0.5, 3, 1),
    character: p.get('character') ?? '',
    hideEmpty: p.get('empty') === 'hide',
    onlyTiered: p.get('only') === 'tiered' || p.get('only') === 'mystery',
    showCurrency: p.get('currency') !== 'hide',
    showShards: p.get('shards') === '1',
    grail: p.get('grail') === 'off' ? 'off' : p.get('grail') === 'season' ? 'season' : 'all',
    sample: p.get('sample') === '1',
  };
}

export function overlayQuery(o: OverlayOptions): string {
  const p = new URLSearchParams();
  if (o.days !== 1) p.set('days', String(o.days));
  if (o.count !== 5) p.set('count', String(o.count));
  if (o.min !== PUL) p.set('min', RUNE_NAMES[o.min - 1]);
  if (o.dayStart !== 6) p.set('dayStart', String(o.dayStart));
  if (o.layout !== 'column') p.set('layout', o.layout);
  if (o.scale !== 1) p.set('scale', String(o.scale));
  if (o.character) p.set('character', o.character);
  if (o.hideEmpty) p.set('empty', 'hide');
  if (o.grail !== 'all') p.set('grail', o.grail);
  if (o.onlyTiered) p.set('only', 'tiered');
  if (!o.showCurrency) p.set('currency', 'hide');
  if (o.showShards) p.set('shards', '1');
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function OverlayView({ options }: { options: OverlayOptions }) {
  useOverlayPage();
  const { days, newFinds, tiers, fresh } = useLiveDrops(options);
  const visibleDays = options.hideEmpty ? days.filter((d) => d.top.length || (options.showCurrency && d.currency.length)) : days;
  const row = options.layout === 'row';

  return (
    <div className="p-4" style={{ zoom: options.scale }}>
      <div className={`flex gap-2.5 ${row ? 'flex-row flex-wrap items-start' : 'w-[400px] flex-col'}`}>
        {visibleDays.map((day, i) => (
          <div key={day.start} className={row ? 'w-[400px]' : ''}>
            <FeedPanel day={day} index={i} newFinds={newFinds} tiers={tiers} fresh={fresh} showCurrency={options.showCurrency} showShards={options.showShards} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Grail counter overlay (/overlay/grail): uniques and sets found, on its own.
 *   scope  all | season (default all)
 *   scale  size multiplier (0.5-3, default 1)
 *   sample 1 -> made-up progress (the Stream tab's preview)
 */
export interface GrailOverlayOptions {
  scope: 'all' | 'season';
  scale: number;
  sample?: boolean;
}

export function parseGrailOverlayOptions(search: string): GrailOverlayOptions {
  const p = new URLSearchParams(search);
  return {
    scope: p.get('scope') === 'season' ? 'season' : 'all',
    scale: clamp(p.has('scale') ? Number(p.get('scale')) : NaN, 0.5, 3, 1),
    sample: p.get('sample') === '1',
  };
}

export function grailOverlayQuery(o: GrailOverlayOptions): string {
  const p = new URLSearchParams();
  if (o.scope !== 'all') p.set('scope', o.scope);
  if (o.scale !== 1) p.set('scale', String(o.scale));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function GrailOverlayView({ options }: { options: GrailOverlayOptions }) {
  useOverlayPage();
  const { grail } = useLiveDrops({ days: 1, count: 0, min: PUL, dayStart: 6, character: '', onlyTiered: false, grail: options.scope, sample: options.sample });
  return (
    <div className="w-[392px] p-4" style={{ zoom: options.scale }}>
      {grail && <GrailPanel grail={grail} large />}
    </div>
  );
}
