import { useEffect, useState } from 'react';
import { RUNE_NAMES } from '../lib/runes';
import { grailOverlayQuery, overlayQuery, parseOverlayOptions, type GrailOverlayOptions, type OverlayOptions } from '../views/OverlayView';
import { btnSm, fieldSm as input } from '../lib/ui';

const field = 'flex items-center justify-between gap-3';

/** A card's options, remembered in this browser, so coming back shows the URL already pasted into OBS. */
function usePersisted<T extends object>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(`horazon.stream.${key}`);
      return saved ? { ...initial, ...JSON.parse(saved) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`horazon.stream.${key}`, JSON.stringify(value));
    } catch {
      // storage blocked: the options last until reload
    }
  }, [key, value]);
  return [value, setValue];
}

/** A read-only URL with a copy button and the Browser Source size to enter with it. */
function CopyUrl({ url, size, label }: { url: string; size: [number, number]; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = () =>
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
      .then(() => setState('copied'), () => setState('failed'))
      .finally(() => setTimeout(() => setState('idle'), 2500));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input readOnly aria-label={`${label} URL`} className={`${input} min-w-0 flex-1 font-mono text-xs`} value={url} onFocus={(e) => e.target.select()} />
        <span className="shrink-0 font-num text-sm font-semibold text-text tabular-nums">
          <span className="sr-only">Browser Source size </span>
          {size[0]} × {size[1]}
        </span>
        <button className={btnSm} onClick={copy} aria-label={`Copy the ${label} URL`}>
          {state === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <span role="status" className={`text-[13px] ${state === 'failed' ? 'text-warn' : 'sr-only'}`}>
        {state === 'copied' ? `${label} URL copied` : state === 'failed' ? 'Copying was blocked: click the URL and copy it with Ctrl+C.' : ''}
      </span>
    </div>
  );
}

// Previews sit on a dark checker standing in for game footage, so the slabs' edges and transparency show.
const checker = { background: 'repeating-conic-gradient(var(--color-panel-hi) 0% 25%, var(--color-bg) 0% 50%) 50% / 20px 20px' };
const SIZES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

function SizeField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className={field}>
      <span className="text-muted">Size</span>
      <select className={input} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {SIZES.map((s) => (
          <option key={s} value={s}>
            {s * 100}%
          </option>
        ))}
      </select>
    </label>
  );
}

/** What the previews show: made-up data (a new install has none) or the streamer's own. */
export interface PreviewMode {
  mine: boolean;
}
const withSample = (path: string, query: string, mine: boolean) => {
  const p = new URLSearchParams(query.replace(/^\?/, ''));
  if (!mine) p.set('sample', '1');
  const s = p.toString();
  return s ? `${path}?${s}` : path;
};

/** One overlay: its title, what it shows, its options, the URL and Browser Source size, the preview. */
function OverlayCard({
  title,
  about,
  options,
  url,
  size,
  preview,
  height,
  scene,
  mine,
  emptyNote,
  wide,
}: {
  title: string;
  about: string;
  options?: React.ReactNode;
  url: string;
  size: [number, number];
  preview: string;
  height: number;
  /** A preview drawn at its real size and scaled down by this factor. */
  scene?: number;
  mine: boolean;
  /** With the streamer's own data: when this overlay shows anything at all. */
  emptyNote?: string;
  wide?: boolean;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-sm border border-line bg-panel ${wide ? 'lg:col-span-2' : ''}`}>
      <h2 className="border-b border-line px-4 py-3 text-base text-text">{title}</h2>
      <div className="flex flex-col gap-3 px-4 py-3 text-sm">
        <p className="max-w-[62ch] text-muted">{about}</p>
        {options}
        <CopyUrl url={url} size={size} label={title} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-muted">
            {mine ? `Preview with your data${emptyNote ? `: ${emptyNote}` : ''}` : 'Preview with sample data'}
          </span>
          {/* Previews are pictures of the overlay: out of the tab order and hidden from screen readers. */}
          {scene ? (
            <div className="overflow-hidden rounded-sm border border-line" style={{ ...checker, width: size[0] * scene, height: size[1] * scene }}>
              <iframe tabIndex={-1} aria-hidden title={`${title} preview`} src={preview} width={size[0]} height={size[1]} style={{ transform: `scale(${scene})`, transformOrigin: '0 0' }} />
            </div>
          ) : (
            <iframe tabIndex={-1} aria-hidden title={`${title} preview`} src={preview} className="w-full rounded-sm border border-line" style={{ ...checker, height }} />
          )}
        </div>
      </div>
    </section>
  );
}

const clampInt = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) && v >= 1 ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);

/** The drop feed: the four choices most streamers make up front, the rest under More options. */
export function OverlayBuilder({ characters, mine }: { characters: string[] } & PreviewMode) {
  const [o, setO] = usePersisted<OverlayOptions>('feed', parseOverlayOptions(''));
  const set = <K extends keyof OverlayOptions>(k: K, v: OverlayOptions[K]) => setO({ ...o, [k]: v });
  const query = overlayQuery(o);
  const row = o.layout === 'row';
  // Column: 400px panels stacked; row: a 400px panel per day, side by side.
  const size: [number, number] = row
    ? [Math.round((32 + o.days * 410) * o.scale), Math.round((52 + o.count * 52 + 52 + 32) * o.scale)]
    : [Math.round(432 * o.scale), Math.round(((52 + o.count * 52 + 52) * o.days + 32) * o.scale)];
  const checkbox = (k: 'onlyTiered' | 'showCurrency' | 'showShards' | 'hideEmpty', label: string) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" className="accent-accent" checked={o[k]} onChange={(e) => set(k, e.target.checked)} />
      <span className="text-muted">{label}</span>
    </label>
  );

  return (
    <section className="rounded-sm border border-line bg-panel lg:col-span-2">
      <h2 className="border-b border-line px-4 py-3 text-base text-text">Drop feed</h2>
      <div className="grid gap-4 px-4 py-3 text-sm md:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-2.5">
          <p className="text-muted">Each day's best drops; new drops slide in live, and new grail finds sparkle. Grail progress is the Grail counter below.</p>
          <label className={field}>
            <span className="text-muted">Days shown</span>
            <input type="number" min={1} max={7} className={`${input} w-16`} value={o.days} onChange={(e) => set('days', clampInt(Number(e.target.value), 1, 7, 1))} />
          </label>
          <label className={field}>
            <span className="text-muted">Drops per day</span>
            <input type="number" min={1} max={10} className={`${input} w-16`} value={o.count} onChange={(e) => set('count', clampInt(Number(e.target.value), 1, 10, 5))} />
          </label>
          <label className={field}>
            <span className="text-muted">Layout</span>
            <select className={input} value={o.layout} onChange={(e) => set('layout', e.target.value as OverlayOptions['layout'])}>
              <option value="column">Column (sidebar)</option>
              <option value="row">Row (bottom bar)</option>
            </select>
          </label>
          <SizeField value={o.scale} onChange={(v) => set('scale', v)} />
          <details className="group mt-1 border-t border-line pt-2">
            <summary className="cursor-pointer text-accent select-none hover:underline">More options</summary>
            <div className="mt-2.5 flex flex-col gap-2.5">
              <label className={field}>
                <span className="text-muted">Runes from</span>
                <select className={input} value={o.min} onChange={(e) => set('min', Number(e.target.value))}>
                  {RUNE_NAMES.map((n, i) => (
                    <option key={n} value={i + 1}>
                      {n}+
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                <span className="text-muted">Day starts at</span>
                <select className={input} value={o.dayStart} onChange={(e) => set('dayStart', Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </label>
              {characters.length > 1 && (
                <label className={field}>
                  <span className="text-muted">Character</span>
                  <select className={input} value={o.character} onChange={(e) => set('character', e.target.value)}>
                    <option value="">All</option>
                    {characters.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className={field}>
                <span className="text-muted">New grail finds</span>
                <select className={input} value={o.grail} onChange={(e) => set('grail', e.target.value as OverlayOptions['grail'])}>
                  <option value="all">Sparkle, all time</option>
                  <option value="season">Sparkle, this season</option>
                  <option value="off">No sparkle</option>
                </select>
              </label>
              {checkbox('onlyTiered', 'Only drops in my tiers')}
              {checkbox('showCurrency', 'Currency line (runes, keys…)')}
              {checkbox('showShards', 'Worldstone Shards in the currency line')}
              {checkbox('hideEmpty', 'Hide days with nothing notable')}
            </div>
          </details>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <CopyUrl url={`${location.origin}/overlay${query}`} size={size} label="Drop feed" />
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted">{mine ? 'Preview with your data: days with nothing notable are a title line' : 'Preview with sample data'}</span>
            <iframe
              tabIndex={-1}
              aria-hidden
              title="Drop feed preview"
              src={withSample('/overlay', query, mine)}
              className="w-full rounded-sm border border-line"
              style={{ ...checker, height: row ? 260 : Math.min(640, Math.max(320, size[1] / o.scale + 24)) }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/** The live run tracker: broadcast for OBS, pilot for the desktop window beside the game. */
export function RunTrackerCard({ mine }: PreviewMode) {
  const [o, setO] = usePersisted('tracker', { view: 'broadcast' as 'broadcast' | 'pilot', scale: 1 });
  const p = new URLSearchParams();
  if (o.view === 'broadcast') p.set('view', 'broadcast');
  if (o.scale !== 1) p.set('scale', String(o.scale));
  const q = p.toString() ? `?${p}` : '';
  const broadcast = o.view === 'broadcast';
  return (
    <OverlayCard
      title="Run tracker"
      about={
        broadcast
          ? 'For viewers: the map, the clock and kills large, the share of the map cleared, and the latest split against your best. Shows while a map run is open, hides between maps.'
          : 'For you: everything the run is measured by (kill rate, map time against best and median, every split and the boss). The desktop app shows this one above the game (tray menu → Map kill counter overlay).'
      }
      options={
        <>
          <label className={field}>
            <span className="text-muted">Version</span>
            <select className={input} value={o.view} onChange={(e) => setO({ ...o, view: e.target.value as 'broadcast' | 'pilot' })}>
              <option value="broadcast">Broadcast (for viewers)</option>
              <option value="pilot">Pilot (for you)</option>
            </select>
          </label>
          <SizeField value={o.scale} onChange={(scale) => setO({ ...o, scale })} />
        </>
      }
      url={`${location.origin}/killcounter${q}`}
      size={broadcast ? [Math.round(680 * o.scale), Math.round(184 * o.scale)] : [Math.round(392 * o.scale), Math.round(520 * o.scale)]}
      preview={withSample('/killcounter', q, mine)}
      height={broadcast ? 0 : 540}
      scene={broadcast ? 0.7 / o.scale : undefined}
      mine={mine}
      emptyNote="empty until a map run is open"
    />
  );
}

/** Moment alerts: one at a time, only when something happens. */
export function MomentsCard({ mine }: PreviewMode) {
  const [o, setO] = usePersisted('moments', { scale: 1 });
  const q = o.scale !== 1 ? `?scale=${o.scale}` : '';
  return (
    <OverlayCard
      title="Moments"
      about="Empty until the run gives something: a drop in your tiers, a new grail find or a Vex+ rune, a split beaten, a new best clear, the boss down. Each one opens, holds six seconds and closes."
      options={<SizeField value={o.scale} onChange={(scale) => setO({ scale })} />}
      url={`${location.origin}/overlay/moments${q}`}
      size={[Math.round(680 * o.scale), Math.round(208 * o.scale)]}
      preview={withSample('/overlay/moments', q, mine)}
      height={0}
      scene={0.7 / o.scale}
      mine={mine}
      emptyNote="empty until something happens in a run"
    />
  );
}

/** The grail counter on its own. */
export function GrailCounterCard({ mine }: PreviewMode) {
  const [grail, setGrail] = usePersisted<GrailOverlayOptions>('grail', { scope: 'all', scale: 1 });
  const q = grailOverlayQuery(grail);
  return (
    <OverlayCard
      title="Grail counter"
      about="Uniques and sets found, each with its bar in the game's quality colour."
      options={
        <>
          <label className={field}>
            <span className="text-muted">Counts</span>
            <select className={input} value={grail.scope} onChange={(e) => setGrail({ ...grail, scope: e.target.value as GrailOverlayOptions['scope'] })}>
              <option value="all">All time</option>
              <option value="season">Current season</option>
            </select>
          </label>
          <SizeField value={grail.scale} onChange={(scale) => setGrail({ ...grail, scale })} />
        </>
      }
      url={`${location.origin}/overlay/grail${q}`}
      size={[Math.round(392 * grail.scale), Math.round(244 * grail.scale)]}
      preview={withSample('/overlay/grail', q, mine)}
      height={0}
      scene={Math.min(1, 1 / grail.scale)}
      mine={mine}
    />
  );
}

/** The session scoreboard scene. */
export function SessionBoardCard({ mine }: PreviewMode) {
  return (
    <OverlayCard
      title="Session scoreboard"
      about="A full-screen scene for a break or the end of a stream: tonight's maps as a board (fastest first, new bests in green), the best find, and the night's totals."
      url={`${location.origin}/overlay/session`}
      size={[1920, 1080]}
      preview={withSample('/overlay/session', '', mine)}
      height={0}
      scene={0.54}
      mine={mine}
      emptyNote="your latest session"
      wide
    />
  );
}
