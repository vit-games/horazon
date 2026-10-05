import { useEffect, useRef, useState } from 'react';
import { ItemIcon } from '../components/ItemIcon';
import { NewMark } from '../components/NewTag';
import { asItem } from '../lib/capture';
import { nameColor } from '../lib/itemStyle';
import { overlayScale, useOverlayPage } from '../lib/overlay';
import { PUL, runeNumber } from '../lib/runes';
import { tierLabel, tierStyle, type TierInfo } from '../lib/tiers';
import { fmtClock } from '../lib/time';
import type { Drop } from '../lib/types';
import { useLiveDrops } from '../lib/useLiveDrops';
import { formatDelta, useKillCounter, type KillCounterData } from './KillCounterView';

/**
 * Moment alerts (/overlay/moments, an OBS Browser Source): empty until the run gives something,
 * then one moment at a time, opened like the portal and closed again after a few seconds:
 * Only what beats a record or is rare, so a moment still means something in hour three (the tracker
 * already shows every split):
 *   - a drop worth stopping for: your top two tiers, a new grail find, Vex and higher runes
 *   - a split reached ahead of your best clear, a new best full clear
 *   - the map's boss down faster than your best
 * Grail finds and high runes are precious: a white-gold edge, a longer hold, and they jump the queue.
 *   scale   size multiplier (0.5-3, default 1)
 *   sample  1 -> cycles sample moments (the preview on the Stream page)
 */
type Moment =
  | { key: string; kind: 'drop'; drop: Drop; tier: TierInfo | null; grail: boolean }
  | { key: string; kind: 'split'; title: string; diff: number | null; at: number; map: string }
  | { key: string; kind: 'boss'; name: string; diff: number | null; at: number; map: string };

const HOLD_MS = 6000;
const PRECIOUS_HOLD_MS = 9000;
const TOP_TIERS = 2; // tiers 1-2 (rank 0-1)
const CLOSE_MS = 750; // the reverse order: words, figure, ring, slab (index.css .ov-closing)
const HIGH_RUNE = 26; // Vex

const sampleDrop = (code: string, name: string): Drop => ({
  id: -1,
  found_at: new Date().toISOString(),
  character: null,
  quantity: 1,
  source: 'sample',
  ignored: false,
  item: (() => {
    const item = asItem({ code, quality: null, uid: null });
    // As the game reports it, so the sample reads as a high rune (runeNumber checks the type).
    return { ...item, name, base: { ...item.base, type_code: 'rune' } };
  })(),
} as unknown as Drop);

const SAMPLES: Moment[] = [
  { key: 's1', kind: 'drop', drop: sampleDrop('r30', 'Ber Rune'), tier: null, grail: false },
  { key: 's2', kind: 'split', title: '50% split', diff: -16, at: 151, map: 'Ancestral Trial' },
  { key: 's3', kind: 'boss', name: 'Nathkill The Numb', diff: -12, at: 280, map: 'Ancestral Trial' },
];

export function MomentsView() {
  useOverlayPage();
  const params = new URLSearchParams(location.search);
  const sample = params.get('sample') === '1';
  const scale = overlayScale(params);
  const [queue, setQueue] = useState<Moment[]>([]);
  const [closing, setClosing] = useState(false);
  // A precious moment goes next (after the one showing), ahead of anything routine already waiting.
  const push = (m: Moment) =>
    setQueue((q) => {
      if (q.some((x) => x.key === m.key)) return q;
      if (!isPrecious(m) || q.length < 2) return [...q, m];
      const at = q.findIndex((x, i) => i > 0 && !isPrecious(x));
      return at < 0 ? [...q, m] : [...q.slice(0, at), m, ...q.slice(at)];
    });

  // Drops: the ones that just arrived and are worth a moment.
  const { drops, fresh, tiers, newFinds } = useLiveDrops({ days: 1, count: 0, min: PUL, dayStart: 6, character: '', onlyTiered: false, grail: 'all', sample });
  useEffect(() => {
    for (const d of drops) {
      if (!fresh.has(d.id) || d.ignored) continue;
      const tier = tiers.get(d.id) ?? null;
      const rune = runeNumber(d.item);
      const grail = newFinds.has(d.id);
      if ((tier && tier.rank < TOP_TIERS) || grail || (rune !== null && rune >= HIGH_RUNE)) push({ key: `d${d.id}`, kind: 'drop', drop: d, tier, grail });
    }
  }, [fresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Splits and the boss: the moment one turns from pending to reached in the same run.
  const live = useKillCounter(false);
  const prev = useRef<KillCounterData>({ state: 'idle' });
  useEffect(() => {
    const was = prev.current;
    prev.current = live;
    // The preview shows its samples only, never a real moment in between.
    if (sample || live.state === 'idle' || live.state === 'boss' || was.state === 'idle' || was.state === 'boss' || was.run.id !== live.run.id) return;
    const map = live.run.name.replace(/ Map$/, '');
    live.splits.forEach((s, i) => {
      if (s.at === null || was.splits[i]?.at !== null) return;
      const diff = s.best !== null ? s.at - s.best : null;
      if (diff === null || diff >= 0) return; // only ahead of your best: the tracker shows every split
      push({ key: `r${live.run.id}-${s.share}`, kind: 'split', title: s.share === 1 ? 'New best clear' : `${s.share * 100}% split`, diff, at: s.at, map });
    });
    if (live.boss && live.boss.at !== null && was.boss?.at == null && live.boss.best !== null && live.boss.at < live.boss.best) {
      push({ key: `r${live.run.id}-boss`, kind: 'boss', name: live.boss.name, diff: live.boss.best !== null ? live.boss.at - live.boss.best : null, at: live.boss.at, map });
    }
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview: the samples in turn.
  useEffect(() => {
    if (!sample) return;
    let i = 0;
    const next = () => push({ ...SAMPLES[i % SAMPLES.length], key: `${SAMPLES[i % SAMPLES.length].key}-${i++}` });
    next();
    const t = setInterval(next, HOLD_MS + CLOSE_MS + 900);
    return () => clearInterval(t);
  }, [sample]); // eslint-disable-line react-hooks/exhaustive-deps

  // One at a time: hold, close, then the next.
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const holdMs = isPrecious(current) ? PRECIOUS_HOLD_MS : HOLD_MS;
    const hold = setTimeout(() => setClosing(true), holdMs);
    const done = setTimeout(() => {
      setClosing(false);
      setQueue((q) => q.slice(1));
    }, holdMs + CLOSE_MS);
    return () => {
      clearTimeout(hold);
      clearTimeout(done);
    };
  }, [current?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4" style={{ zoom: scale }}>
      {current && <MomentCard key={current.key} m={current} closing={closing} />}
    </div>
  );
}

/**
 * The portal opening: the ring flares (white-gold for a grail find or a high rune, glyph blue
 * otherwise), the figure rises inside it, then the words; closing runs the other way.
 */
const isPrecious = (m: Moment) => m.kind === 'drop' && (m.grail || (runeNumber(m.drop.item) ?? 0) >= HIGH_RUNE);

function MomentCard({ m, closing }: { m: Moment; closing: boolean }) {
  const precious = isPrecious(m);
  const ring = precious ? 'var(--color-grail)' : 'var(--color-accent)';
  // Art glows in its tier's colour; an untiered grail find or high rune glows white-gold.
  const glow = m.kind === 'drop' ? (m.tier ? tierStyle(m.tier) : precious ? ({ '--tier': 'var(--color-grail)' } as React.CSSProperties) : undefined) : undefined;
  const pace = (diff: number | null) => (diff === null ? 'text-text' : diff <= 0 ? 'text-q-set' : 'text-q-red');
  return (
    // Sized to its content (one 40px step wide at least), so a short moment is a short slab.
    <div className={`ov-slab ov-pad inline-flex max-w-[640px] min-w-[400px] items-center gap-5 ${closing ? 'ov-closing' : 'ov-open'} ${precious && !closing ? 'ov-wake-grail' : ''}`} role="status">
      <div className="relative flex h-[120px] w-[120px] shrink-0 items-center justify-center">
        <div className="ov-step-3 absolute inset-1">
          <div className="ov-ring absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${ring}, 0 0 16px ${ring}` }} />
          <div className="ov-settle absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 1.5px ${ring}, inset 0 0 18px rgb(132 172 255 / 0.12)`, opacity: 0.7 }} />
        </div>
        <div className="ov-step-2 relative">
        <div className="ov-rise" style={{ animationDelay: '0.25s' }}>
          {m.kind === 'drop' ? (
            <div className={precious ? 'tier-glow-strong' : glow ? 'tier-glow' : ''} style={glow}>
              {/* Up to 3x: the night's best moments get the biggest art (a rune at 84px). */}
              <ItemIcon item={m.drop.item} box={112} grow maxStep={3} />
            </div>
          ) : (
            <span className={`font-num text-[40px] leading-none font-bold tabular-nums ov-ink ${pace(m.diff)}`}>{m.diff !== null ? formatDelta(m.diff) : fmtClock(m.at)}</span>
          )}
        </div>
        </div>
      </div>
      <div className="ov-step-1 min-w-0 pr-2">
      <div className="ov-rise flex min-w-0 flex-col gap-1.5 ov-ink" style={{ animationDelay: '0.45s' }}>
        {m.kind === 'drop' ? (
          <>
            <h2 className={`font-display text-[28px] leading-tight font-bold ${nameColor(m.drop.item)}`}>{m.drop.item.name}</h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg font-semibold">
              {m.grail && (
                <span className="flex items-center gap-1.5 text-grail">
                  <NewMark size={18} /> New for the grail
                </span>
              )}
              {m.tier && <span style={{ color: m.tier.color }}>{tierLabel(m.tier)}</span>}
              {!m.tier && !m.grail && <span className="text-grail">High rune</span>}
            </p>
          </>
        ) : m.kind === 'split' ? (
          <>
            <h2 className="font-display text-[28px] leading-tight font-bold text-text">{m.title}</h2>
            <p className="font-num text-lg font-semibold text-muted tabular-nums">
              {fmtClock(m.at)} on {m.map}
              {m.diff !== null && <span>{` · best ${fmtClock(m.at - m.diff)}`}</span>}
            </p>
          </>
        ) : (
          <>
            <h2 className="font-display text-[28px] leading-tight font-bold text-text">{m.name}</h2>
            <p className="font-num text-lg font-semibold text-muted tabular-nums">
              Down at {fmtClock(m.at)} on {m.map}
              {m.diff !== null && <span>{` · best ${fmtClock(m.at - m.diff)}`}</span>}
            </p>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
