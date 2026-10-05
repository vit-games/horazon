import { useEffect, useMemo, useState } from 'react';
import { ItemIcon } from '../components/ItemIcon';
import { runMapLabel } from '../components/MapSections';
import { NewMark } from '../components/NewTag';
import { Portal } from '../components/Portal';
import { fetchDrops, fetchGrail } from '../lib/api';
import { fetchCaptureGames, fetchRuns, isClear, runKills, type CaptureGame, type MapRun } from '../lib/capture';
import { nameColor } from '../lib/itemStyle';
import { useChanges } from '../lib/live';
import { useOverlayPage } from '../lib/overlay';
import { isNotable, rankScore } from '../lib/rank';
import { PUL } from '../lib/runes';
import { tierLabel, tierOf, tierStyle } from '../lib/tiers';
import { fmtClock } from '../lib/time';
import type { Drop } from '../lib/types';
import { sampleItem } from '../lib/sampleOverlay';
import { useValues } from '../lib/values';
import { formatDelta } from './KillCounterView';
import { fastestClears, lastSession } from './SessionView';

/**
 * Session scoreboard (/overlay/session): a full 1920x1080 scene for a break or the end of a stream.
 * The night's map runs as a board (fastest first, new bests marked), the best drop beside it, the
 * night's totals along the foot. Opaque: it is a scene, not a layer over the game.
 *   sample 1 -> made-up runs and drops (the preview on the Stream page)
 */
interface Board {
  start: Date;
  end: Date;
  runs: MapRun[];
  drops: Drop[];
  newFinds: Set<number>;
  fastest: Map<number, number>;
  earlierBest: Map<number, number>;
}

const SLOTS = 8;
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function useBoard(): Board | null {
  const [games, setGames] = useState<CaptureGame[] | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const version = useChanges('drops', 'runs', 'live');
  useEffect(() => {
    fetchCaptureGames().then(setGames, () => {});
  }, [version]);
  const session = useMemo(() => (games ? lastSession(games, false) : null), [games]);
  useEffect(() => {
    if (!session) return;
    const since = session.start;
    Promise.all([fetchDrops({ since, until: null }), fetchRuns({ since, until: null }), fetchRuns({ since: null, until: since }), fetchGrail()]).then(
      ([drops, now, before, grail]) => {
        const earlierBest = new Map<number, number>();
        for (const r of before.runs.filter(isClear)) earlierBest.set(r.area, Math.min(r.seconds, earlierBest.get(r.area) ?? Infinity));
        setBoard({
          ...session,
          runs: now.runs,
          drops: drops.filter((d) => !d.ignored),
          newFinds: new Set(grail.flatMap((g) => (g.drop_id === null ? [] : [g.drop_id]))),
          fastest: fastestClears(now.runs, before.runs),
          earlierBest,
        });
      },
      () => {},
    );
  }, [session?.start.getTime(), version]); // eslint-disable-line react-hooks/exhaustive-deps
  return board;
}

/** One line per map: its best clear tonight, against your best before tonight. */
function boardRows(b: Board) {
  const byArea = new Map<number, MapRun[]>();
  for (const r of b.runs.filter((r) => r.kind === 'map')) byArea.set(r.area, [...(byArea.get(r.area) ?? []), r]);
  return [...byArea.values()]
    .map((runs) => {
      const clears = runs.filter(isClear);
      const best = clears.length ? clears.reduce((a, c) => (c.seconds < a.seconds ? c : a)) : null;
      const before = b.earlierBest.get(runs[0].area) ?? null;
      return {
        label: runMapLabel(runs[0]),
        runs: runs.length,
        best: best?.seconds ?? null,
        diff: best && before !== null ? best.seconds - before : null,
        newBest: runs.some((r) => b.fastest.has(r.id)),
        kills: runs.reduce((n, r) => n + runKills(r).n, 0),
      };
    })
    .sort((a, c) => (a.best ?? Infinity) - (c.best ?? Infinity));
}

export function SessionBoardView() {
  useOverlayPage();
  const values = useValues();
  const live = useBoard();
  const sample = new URLSearchParams(location.search).get('sample') === '1';
  const b = sample ? null : live;
  // Without a session (or before it loads) the scene says so: made-up runs only in the preview.
  const waiting = !sample && !b;
  const rows = b ? boardRows(b).slice(0, SLOTS) : sample ? SAMPLE_ROWS : [];
  const notable = b ? b.drops.filter((d) => isNotable(d, PUL, tierOf(d.item, values))) : [];
  const best = [...notable].sort((x, y) => rankScore(y, b!.newFinds, tierOf(y.item, values)) - rankScore(x, b!.newFinds, tierOf(x.item, values)))[0];
  const grailCount = b ? b.drops.filter((d) => b.newFinds.has(d.id)).length : 3;
  const maps = b ? b.runs.filter((r) => r.kind === 'map').length : 11;
  const kills = b ? b.runs.reduce((n, r) => n + runKills(r).n, 0) : 23418;
  const seconds = b ? b.runs.reduce((n, r) => n + r.seconds, 0) : 4210;
  const newBests = b ? b.fastest.size : 2;
  const tier = best ? tierOf(best.item, values) : sample ? tierOf(SAMPLE_BEST.item, values) : null;
  // A session that started in daylight is today's, not tonight's.
  const startHour = (b?.start ?? new Date(2026, 9, 3, 21)).getHours();
  const title = startHour >= 17 || startHour < 5 ? "Tonight's runs" : "Today's runs";

  return (
    <div
      className="flex h-[1080px] w-[1920px] flex-col gap-12 px-24 pt-20 pb-16 text-text"
      style={{
        background:
          'radial-gradient(ellipse 70% 55% at 85% -10%, rgb(88 80 220 / 0.24), transparent 70%), radial-gradient(ellipse 60% 50% at 10% 110%, rgb(120 70 200 / 0.12), transparent 70%), var(--color-bg)',
      }}
    >
      <header className="flex items-end gap-6">
        <Portal state="live" size={84} />
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-[72px] leading-none font-bold text-sigil">{title}</h1>
          <p className="font-num text-[30px] font-medium text-muted">
            {b ? `${dayFmt.format(b.start)} · ${timeFmt.format(b.start)}–${timeFmt.format(b.end)}` : sample ? 'Saturday, October 3 · 9:02 PM–11:14 PM' : 'No session yet'}
          </p>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_520px] gap-12">
        <div className="flex min-h-0 flex-col gap-10">
          {/* The board: eight slots whatever the night held, fastest clear first, new bests in green. */}
          <section className="ov-slab flex min-h-0 flex-1 flex-col">
            <div className="ov-rule grid grid-cols-[minmax(0,1fr)_140px_200px_160px] gap-6 border-b px-8 py-4 font-num text-[22px] font-medium text-muted">
              <span>Map</span>
              <span className="text-right">Runs</span>
              <span className="text-right">Best clear</span>
              <span className="text-right">Kills</span>
            </div>
            {Array.from({ length: SLOTS }, (_, i) => rows[i]).map((r, i) => (
              <div key={i} className="ov-rule grid flex-1 grid-cols-[minmax(0,1fr)_140px_200px_160px] items-center gap-6 border-b px-8 last:border-0">
                {r ? (
                  <>
                    <span className="flex min-w-0 items-baseline gap-4">
                      {r.label.tier && <span className="shrink-0 font-num text-[26px] font-semibold text-muted">{r.label.tier}</span>}
                      <span className={`truncate font-display text-[32px] leading-tight font-bold ${r.label.color}`}>{r.label.name}</span>
                    </span>
                    <span className="text-right font-num text-[30px] font-semibold tabular-nums">{r.runs}</span>
                    <span className="text-right font-num text-[30px] font-semibold tabular-nums">
                      {r.best !== null ? fmtClock(r.best) : <span className="text-faint">–</span>}
                      {r.newBest && r.diff !== null && <span className="ml-3 text-[22px] text-q-set">{formatDelta(r.diff)}</span>}
                    </span>
                    <span className="text-right font-num text-[30px] font-semibold text-muted tabular-nums">{r.kills.toLocaleString()}</span>
                  </>
                ) : (
                  i === 0 && <span className="text-[26px] text-muted">{waiting ? 'The board fills in as maps are run.' : 'No maps run tonight.'}</span>
                )}
              </div>
            ))}
          </section>

          {/* The night: one giant figure (the maps run), the rest as one supporting line. */}
          <footer className={`flex items-baseline gap-8 font-num text-muted ${waiting ? 'invisible' : ''}`}>
            <span className="flex items-baseline gap-3 text-[30px]">
              <span className="text-[96px] leading-none font-bold text-text">{maps}</span>
              {maps === 1 ? 'map run' : 'maps run'}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-3 text-[30px]">
              <span><span className="font-semibold text-text">{fmtClock(seconds)}</span> in maps</span>
              <span className="text-faint">·</span>
              <span><span className="font-semibold text-text">{kills.toLocaleString()}</span> kills</span>
              {newBests > 0 && (
                <>
                  <span className="text-faint">·</span>
                  <span><span className="font-semibold text-q-set">{newBests}</span> new best {newBests === 1 ? 'clear' : 'clears'}</span>
                </>
              )}
              {grailCount > 0 && (
                <>
                  <span className="text-faint">·</span>
                  <span className="flex items-baseline gap-2">
                    <NewMark size={24} />
                    <span className="font-semibold text-grail">{grailCount}</span> new for the grail
                  </span>
                </>
              )}
            </span>
          </footer>
        </div>

        {/* The night's best drop: its art large (whole-number steps up to 4x) over its tier glow, full height beside the board. */}
        <section className="ov-slab flex flex-col items-center justify-center gap-6 px-10 py-10 text-center">
          <h2 className="font-display text-[26px] font-bold text-muted">Best find</h2>
          {best || sample ? (
            <>
              <div className={tier ? 'tier-glow' : ''} style={tierStyle(tier)}>
                <ItemIcon item={best?.item ?? SAMPLE_BEST.item} box={224} grow maxStep={4} />
              </div>
              <p className={`font-display text-[40px] leading-tight font-bold ${best ? nameColor(best.item) : 'text-q-unique'}`}>{best?.item.name ?? SAMPLE_BEST.item.name}</p>
              <p className="flex items-center gap-2 text-[26px] font-semibold">
                {best && b?.newFinds.has(best.id) && (
                  <span className="flex items-center gap-2 text-grail">
                    <NewMark size={22} /> New for the grail
                  </span>
                )}
                {tier && <span style={{ color: tier.color }}>{tierLabel(tier)}</span>}
              </p>
            </>
          ) : (
            <p className="text-[26px] text-muted">Nothing notable tonight.</p>
          )}
        </section>
      </div>
    </div>
  );
}

// The preview's made-up night (?sample=1), so the Stream page can show the scene before a session exists.
const SAMPLE_ROWS = [
  { label: { name: 'Ancestral Trial', tier: 'T1', color: 'text-q-rare' }, runs: 4, best: 281, diff: -16, newBest: true, kills: 8204 },
  { label: { name: "Horazon's Memory", tier: 'T2', color: 'text-q-rare' }, runs: 3, best: 371, diff: -77, newBest: true, kills: 6348 },
  { label: { name: 'Ruined Cistern', tier: 'T2', color: 'text-q-magic' }, runs: 2, best: 321, diff: 12, newBest: false, kills: 4120 },
  { label: { name: 'Arreat Battlefield', tier: 'T3', color: 'text-q-rare' }, runs: 2, best: 411, diff: null, newBest: false, kills: 4746 },
];
const SAMPLE_BEST = { item: sampleItem('Harlequin Crest', 'Unique', 'uap') };
