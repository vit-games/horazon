import { useEffect, useMemo, useRef, useState } from 'react';
import { DropsView, TiersView } from './views/DropsView';
import { GrailView } from './views/GrailView';
import { ProgressView } from './views/ProgressView';
import { SessionView } from './views/SessionView';
import { SettingsView } from './views/SettingsView';
import { StreamView } from './views/StreamView';
import { TradeView } from './views/TradeView';
import { SymbolKey } from './components/SymbolKey';
import { UpdateNotes } from './components/UpdateNotes';
import { Portal, Rune, Wordmark } from './components/Portal';
import { fetchSeasons, type Range, type Season } from './lib/api';
import { areaName, townName } from './lib/capture';
import { TradeReviewContext, useTradeReviewLoader } from './lib/review';
import { useSystemStatus, type SystemStatus } from './lib/status';
import { ValuesContext, useValuesLoader } from './lib/values';

const TABS = [
  { key: 'session', label: 'Session' },
  { key: 'runs', label: 'Runs' },
  { key: 'drops', label: 'Drops' },
  { key: 'grail', label: 'Grail' },
  { key: 'trade', label: 'Trade' },
  { key: 'stream', label: 'Stream' },
  { key: 'setup', label: 'Setup' },
] as const;
type Tab = (typeof TABS)[number]['key'];
/** Stream and Setup sit apart at the bottom of the rail: things you set up, not things you read. */
const SETUP_TABS: Tab[] = ['stream', 'setup'];

/** Old links land where their page lives now: Progress split into Runs, Activity (now Session's history) and Drops → Currency; Grail's records sit on its page. */
const MOVED: Record<string, string> = {
  '#grail/tiers': '#drops/tiers',
  '#grail/records': '#grail',
  '#maps': '#runs/maps',
  '#progress': '#runs',
  '#progress/maps': '#runs/maps',
  '#progress/zones': '#runs/zones',
  '#progress/bossing': '#runs/bossing',
  '#progress/overview': '#session',
  '#activity': '#session',
  '#progress/currency': '#drops/currency',
  '#progress/runes': '#drops/currency',
  '#settings': '#setup',
};

const tabFromHash = (): Tab => {
  const moved = MOVED[location.hash];
  if (moved) history.replaceState(null, '', moved);
  const hash = location.hash.split('/')[0]; // `#runs/zones` -> Runs (subtab handled there)
  return TABS.find((t) => `#${t.key}` === hash)?.key ?? 'session';
};

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayTimeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const when = (iso: string) => {
  const d = new Date(iso);
  return (d.toDateString() === new Date().toDateString() ? timeFmt : dayTimeFmt).format(d);
};

/** Digits switch sections, `/` jumps to the page's search, ←/→ step the page's day - unless typing somewhere. */
function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A view that used the key itself (the tier editor's 1-9) has the say.
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= TABS.length) {
        location.hash = TABS[n - 1].key;
      } else if (e.key === '/') {
        const search = document.querySelector<HTMLInputElement>('[data-hotkey-search]');
        if (search) {
          e.preventDefault();
          search.focus();
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Only from the page itself, so arrows keep working inside segments, sliders and tables.
        if (t !== document.body && t.tagName !== 'MAIN') return;
        const step = document.querySelector<HTMLButtonElement>(`[data-hotkey-day="${e.key === 'ArrowLeft' ? 'older' : 'newer'}"]`);
        if (step && !step.disabled) {
          e.preventDefault();
          step.click();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Recording and polling state on every screen; trouble links to its fix. */
const GAP_KEY = 'horazon.dismissedGap';

function StatusStrip({ status, children }: { status: SystemStatus; children?: React.ReactNode }) {
  const g = status.capture?.game;
  // A setup gap the player chose to live with stays dismissed until it changes; trouble never hides.
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(GAP_KEY);
    } catch {
      return null;
    }
  });
  const dismiss = () => {
    setDismissed(status.syncGap);
    try {
      localStorage.setItem(GAP_KEY, status.syncGap ?? '');
    } catch {
      // storage blocked: dismissed until reload
    }
  };
  const where = g ? townName(g.area) ?? (g.area ? areaName(g.area) : null) : null;
  return (
    // min-h: the season select's height, so the strip doesn't jump between pages with and without it.
    // One line from md up, so nothing below it jumps: the setup note gives way (truncated, full text on
    // hover) before the capture state or the season select do.
    <div className="flex min-h-[calc(1.875rem+0.75rem)] flex-wrap items-center gap-x-6 gap-y-2 border-b border-line/70 pb-3 text-sm md:flex-nowrap">
      {/* Live regions only where a change matters (recording, trouble), not on every poll's time. */}
      <span className="flex shrink-0 items-center gap-2" role="status">
        <Portal state={status.live ? 'live' : 'idle'} size={16} />
        {status.live ? (
          // The loudest thing in the strip: brighter and heavier than any setup note beside it.
          <span className="font-semibold text-text">
            Recording{g?.character ? ` · ${g.character}` : ''}
            {where && <span className="font-medium text-text/80"> · {where}</span>}
          </span>
        ) : status.capture?.lastEventAt ? (
          <span className="text-muted">Capture idle · last game {when(status.capture.lastEventAt)}</span>
        ) : (
          <span className="text-muted">Waiting for the first game</span>
        )}
      </span>
      {!status.syncProblem && status.lastPoll && <span className="shrink-0 text-muted" title="When Horazon last read your stash and characters' items">Items checked {when(status.lastPoll)}</span>}
      <span role="status" className="contents">
        {status.captureProblem ? (
          <a href="#setup/connection" className="flex min-w-0 items-center gap-2 font-semibold text-q-red hover:underline" title={status.captureProblem}>
            <span className="h-2 w-2 shrink-0 rotate-45 bg-q-red" aria-hidden />
            <span className="truncate">{status.captureProblem}</span>
            <span className="shrink-0">· Fix in Setup</span>
          </a>
        ) : status.syncProblem ? (
          <a
            href={/token/i.test(status.syncProblem) ? '#setup/stash' : '#setup/checks'}
            className="flex min-w-0 items-center gap-2 font-semibold text-q-red hover:underline"
            title={status.syncProblem}
          >
            <span className="h-2 w-2 shrink-0 rotate-45 bg-q-red" aria-hidden />
            <span className="truncate">{status.syncProblem}</span>
            <span className="shrink-0">· Fix in Setup</span>
          </a>
        ) : (
          status.syncGap &&
          status.syncGap !== dismissed && (
            <span className="flex min-w-0 items-center gap-2 text-warn">
              <a href="#setup/stash" className="flex min-w-0 items-center gap-2 hover:underline" title={status.syncGap}>
                <span className="h-2 w-2 shrink-0 rotate-45 border border-warn" aria-hidden />
                <span className="truncate">{status.syncGap}</span>
                <span className="shrink-0">· Set up</span>
              </a>
              <button className="shrink-0 rounded-sm border border-line px-2.5 py-1 text-[13px] text-muted hover:border-accent/50 hover:text-text" onClick={dismiss} title="Hide this until it changes; Setup still shows it">
                Dismiss
              </button>
            </span>
          )
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        <UpdateNotes />
        {children}
        <SymbolKey />
      </span>
    </div>
  );
}

export default function App() {
  // Preset key, `season:<n>`, or `season:current` (the default) until seasons are known.
  const [rangeKey, setRangeKey] = useState<string>('season:current');
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [hash, setHash] = useState(location.hash);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const values = useValuesLoader();
  const review = useTradeReviewLoader();
  const status = useSystemStatus();
  useHotkeys();
  const scroller = useRef<HTMLElement>(null);
  // Each section opens at its top, as a page would.
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    const onHash = () => (setTab(tabFromHash()), setHash(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    fetchSeasons().then(setSeasons, () => {});
  }, []);

  const current = seasons.find((s) => !s.end);
  const key = rangeKey === 'season:current' ? (current ? `season:${current.number}` : 'all') : rangeKey;

  // Recomputed only when the selection changes, so views don't refetch on every render.
  const range: Range = useMemo(() => {
    if (key.startsWith('season:')) {
      const s = seasons.find((s) => `season:${s.number}` === key);
      return { since: s ? new Date(s.start) : null, until: s?.end ? new Date(s.end) : null };
    }
    return { since: null, until: null }; // all time
  }, [key, seasons]);

  const season = seasons.find((s) => `season:${s.number}` === key);
  const haulTitle =
    { all: 'All-time haul' }[key] ??
    `${season?.name ?? 'Season'} haul`;

  // Not on the tier editor: tiers have no period.
  const tiers = tab === 'drops' && hash === '#drops/tiers';
  const currency = tab === 'drops' && hash === '#drops/currency';
  const showRange = (tab === 'drops' && !tiers) || tab === 'runs' || tab === 'session' || tab === 'trade' || tab === 'grail';

  const navLink = (t: (typeof TABS)[number], i: number) => {
    const active = tab === t.key;
    return (
      <a
        key={t.key}
        href={`#${t.key}`}
        aria-current={active ? 'page' : undefined}
        className={`group flex items-center gap-2.5 rounded-sm px-3 py-2 text-[15px] font-semibold whitespace-nowrap transition-[color,background-color] ${
          active ? 'bg-panel-hi text-text' : 'text-muted hover:bg-panel/70 hover:text-text'
        }`}
      >
        <Rune name={t.key} active={active} />
        {t.label}
        {t.key === 'trade' && review.toReview.length > 0 && (
          <span
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 font-num text-xs leading-none font-bold text-bg"
            title={`${review.toReview.length} to review: list or stash`}
            aria-label={`, ${review.toReview.length} to review`}
          >
            {review.toReview.length}
          </span>
        )}
        <kbd className="ml-auto hidden font-num text-xs font-semibold text-faint md:inline">{i + 1}</kbd>
      </a>
    );
  };

  return (
    <ValuesContext.Provider value={values}>
    <TradeReviewContext.Provider value={review}>
      {/* A desktop frame from md up: the rail and the status strip stay put, only the view scrolls. */}
      {/* Keyboard users skip the rail. A button, not a link: the hash is the route. */}
      <button
        className="sr-only z-50 rounded-sm border border-line bg-panel-hi text-sm text-text focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:px-3 focus-visible:py-2"
        onClick={() => scroller.current?.focus()}
      >
        Skip to content
      </button>
      <div className="min-h-screen md:grid md:h-screen md:grid-cols-[212px_minmax(0,1fr)] md:grid-rows-1 md:overflow-hidden">
        <aside className="z-20 border-b border-line bg-rail md:flex md:flex-col md:overflow-y-auto md:border-r md:border-b-0">
          <div className="flex items-center gap-4 px-4 py-3 md:block md:px-5 md:pt-6 md:pb-7">
            <a href="#session" aria-label="Horazon - session">
              <Wordmark state={status.portal} />
            </a>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2 [mask-image:linear-gradient(90deg,#000_85%,transparent)] md:flex-1 md:[mask-image:none] md:flex-col md:overflow-visible md:px-3 md:pb-4" aria-label="Sections">
            {TABS.filter((t) => !SETUP_TABS.includes(t.key)).map((t) => navLink(t, TABS.indexOf(t)))}
            <span className="mx-1 w-px shrink-0 bg-line md:mx-0 md:mt-auto md:mb-1 md:h-px md:w-auto" aria-hidden />
            {TABS.filter((t) => SETUP_TABS.includes(t.key)).map((t) => navLink(t, TABS.indexOf(t)))}
          </nav>
          <p className="hidden px-5 pb-5 text-xs leading-snug text-muted md:block">
            Not affiliated with Project Diablo 2 or Blizzard. Horazon reads the game's network traffic; use it at your own risk.
          </p>
        </aside>

        <div className="flex min-w-0 flex-col md:min-h-0">
          <header className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-5 md:px-8 md:pt-6">
            <StatusStrip status={status}>
              {showRange && seasons.length > 0 && (
                <select
                  className="rounded-sm border border-line bg-panel px-2 py-1 text-sm font-semibold text-text hover:border-accent/50"
                  value={key}
                  onChange={(e) => setRangeKey(e.target.value)}
                  aria-label="Season"
                >
                  {[...seasons].reverse().map((s) => (
                    <option key={s.number} value={`season:${s.number}`} className="bg-panel text-text">
                      {s.name}
                      {s.end ? '' : ' (current)'}
                    </option>
                  ))}
                  <option value="all" className="bg-panel text-text">
                    All time
                  </option>
                </select>
              )}
            </StatusStrip>
          </header>

          {/* tabIndex: clicking into the view lets Page Down and Space scroll it. */}
          <main ref={scroller} className="flex-1 md:min-h-0 md:overflow-y-auto" tabIndex={-1}>
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-5 pb-8 md:px-8">
              {/* Session and Grail head themselves; every other page gets its name as the page heading for screen readers. */}
              {tab !== 'session' && tab !== 'grail' && <h1 className="sr-only">{TABS.find((t) => t.key === tab)?.label}</h1>}
              {tab === 'session' && (
                <>
                  <SessionView status={status} />
                  {/* Named after the period picked above: the session itself ignores it, its history follows it. */}
                  <ProgressView range={range} section="activity" title={season ? `${season.name} history` : 'All-time history'} />
                </>
              )}
              {tab === 'runs' && <ProgressView range={range} section="runs" />}
              {tab === 'drops' && (tiers ? <TiersView /> : currency ? <ProgressView range={range} section="currency" /> : <DropsView range={range} title={haulTitle} />)}
              {tab === 'grail' && <GrailView range={range} />}
              {tab === 'trade' && <TradeView range={range} />}
              {tab === 'stream' && <StreamView />}
              {tab === 'setup' && <SettingsView />}
              {/* The rail carries this from md up; narrow screens get it at the foot of every page. */}
              <p className="mt-4 border-t border-line/70 pt-3 text-xs leading-snug text-muted md:hidden">
                Not affiliated with Project Diablo 2 or Blizzard. Horazon reads the game's network traffic; use it at your own risk.
              </p>
            </div>
          </main>
        </div>
      </div>
    </TradeReviewContext.Provider>
    </ValuesContext.Provider>
  );
}
