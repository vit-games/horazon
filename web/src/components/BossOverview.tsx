import { Fragment, useMemo, useState } from 'react';
import { useFocusOnce, useFocusedRow } from './MapSections';
import { NonLadderTag } from './CharacterPicker';
import { ClassIcon } from './ClassIcon';
import { EventIcon } from './EventIcon';
import { ItemIcon } from './ItemIcon';
import { FloatingTooltip } from './ItemTooltip';
import { Ledger } from './Ledger';
import { SortHead, sortRows, useRunGrail, type SortState, type Sorts } from './MapSections';
import { NewMark } from './NewTag';
import { Pager } from './Pager';
import { Seg } from './Seg';
import { Segmented } from './Segmented';
import { asItem, captureName, deleteRun, isNotableFind, itemColor, playerDeaths, type MapRun } from '../lib/capture';
import { fmtNumber } from '../lib/series';
import { fmtClock } from '../lib/time';
import type { CharacterInfo, Item } from '../lib/types';
import { toolbarSm as select } from '../lib/ui';
import { useValues } from '../lib/values';
import type { BossFight } from '../views/KillCounterView';

/**
 * Uber encounters in the order players take them on, each with its bosses in the game's order.
 * Only the first three have tiers (set by cubing the summon item).
 */
const ENCOUNTERS = [
  { name: 'Lucion', tiered: true, bosses: ['Lucion'] },
  { name: 'Rathma', tiered: true, bosses: ['Rathma', 'Mendeln'] },
  { name: 'Diablo Clone', tiered: true, bosses: ['Diablo Clone'] },
  { name: 'Uber Tristram', tiered: false, bosses: ['Mephisto', 'Diablo', 'Baal'] },
  { name: 'Uber Ancients', tiered: false, bosses: ['Talic', 'Madawc', 'Korlic'] },
];
const TIERS = [0, 1, 2];
/** Rathma's fight moves through three arenas; boss HP counts in the last one. */
const RATHMA_ARENAS = ['Swamp', 'Jungle', 'Void'];
/** Tier 0 and Uber Tristram leave three portals: four entries in all. Elsewhere one life. */
const TRIES = 4;
const PAGE_SIZE = 25;
const VIEW_KEY = 'horazon.bossing.view';
const FILTER_KEY = 'horazon.bossFilter';

const startFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const encounterOf = (name: string) => ENCOUNTERS.find((e) => e.name === name);

type Character = Pick<CharacterInfo, 'name' | 'class' | 'level' | 'ladder'>;
/** How one entry into the fight ended. */
export type Try = 'died' | 'killed' | 'left' | 'live';

/** One summon: every game entered with it, rejoins included. */
export interface Fight {
  key: string;
  boss: string;
  tier: number | null;
  start: number;
  runs: MapRun[];
  /** From the summon to the kill; null when it didn't die. */
  killSeconds: number | null;
  deaths: number;
  /** Each boss's lowest HP (%) over the fight (Rathma: in the Void). */
  bosses: Record<string, number>;
  /** Rathma: the arena reached, 1-3. */
  phase: number | null;
  /** Re-entry through the summon's portals: four entries. */
  retries: boolean;
  /** Each entry into the fight and how it ended. */
  tries: Try[];
  open: boolean;
  seconds: number;
  character: string | null;
  ladder: boolean | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * How far a fight got. `rank` orders fights by it (lower is closer to a kill); `count` and `name`
 * say it: "1/3 killed" and the weakest boss standing, the arena Rathma's fight reached, or the HP.
 */
export function progressOf(f: Fight): { rank: number; hp: number | null; count: string | null; name: string | null } {
  if (f.killSeconds !== null) return { rank: 0, hp: 0, count: null, name: null };
  const enc = encounterOf(f.boss);
  if (f.boss === 'Rathma' && f.phase !== null && f.phase < 3)
    return { rank: 100 + (3 - f.phase) * 100, hp: null, count: `${RATHMA_ARENAS[f.phase - 1]} · phase ${f.phase} of 3`, name: null };
  const seen = Object.entries(f.bosses);
  if (!seen.length) return { rank: Infinity, hp: null, count: null, name: null };
  if ((enc?.bosses.length ?? 1) === 1) return { rank: seen[0][1], hp: seen[0][1], count: null, name: null };
  // Several bosses: the ones down, and the weakest still standing. The Ancients fought are the ones seen.
  const total = f.boss === 'Uber Ancients' ? seen.length : enc!.bosses.length;
  const alive = seen.filter(([, hp]) => hp > 0).sort(([, a], [, b]) => a - b);
  const left = alive.reduce((n, [, hp]) => n + hp, 0) + (total - seen.length) * 100;
  return { rank: left / total, hp: alive[0]?.[1] ?? null, count: `${seen.length - alive.length}/${total} killed`, name: alive[0]?.[0] ?? null };
}

export function buildFights(all: MapRun[]): Fight[] {
  const groups = new Map<string, MapRun[]>();
  for (const r of all) {
    if (r.kind !== 'boss' || !r.boss) continue;
    const key = `${r.boss}|${r.summoned_at ?? `run ${r.id}`}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, runs]): Fight => {
      runs.sort((a, b) => a.started_at.localeCompare(b.started_at));
      const kills = runs.map((r) => r.boss_seconds).filter((s): s is number => s !== null);
      const boss = runs[0].boss!;
      const tier = runs[0].boss_tier;
      // An unknown tier gets the benefit of the doubt: counted as one with re-entry.
      const retries = boss === 'Uber Tristram' || (!!encounterOf(boss)?.tiered && tier !== 1 && tier !== 2);
      const open = runs.some((r) => r.open);
      const bosses: Record<string, number> = {};
      for (const r of runs) for (const [n, hp] of Object.entries(r.boss_detail?.bosses ?? {})) bosses[n] = Math.min(bosses[n] ?? hp, hp);
      // Each entry ended in what happened inside it: a death, the kill, or walking out (an entry used all the same).
      const events = runs.flatMap((r) => r.events);
      const within = (kind: string, at: number, end: number) => events.some((e) => e.kind === kind && Date.parse(e.at) >= at && Date.parse(e.at) <= end);
      const entries = runs.flatMap((r) => r.entries ?? []);
      const tries = entries.map((e, i): Try => {
        const at = Date.parse(e.at);
        const end = e.end ? Date.parse(e.end) : Date.now();
        if (within('uber_killed', at, end)) return 'killed';
        if (within('death', at, end)) return 'died';
        return open && i === entries.length - 1 ? 'live' : 'left';
      });
      return {
        key,
        boss,
        tier,
        start: Math.min(...runs.map((r) => Date.parse(r.summoned_at ?? r.started_at))),
        runs,
        killSeconds: kills.length ? Math.min(...kills) : null,
        deaths: runs.reduce((n, r) => n + playerDeaths(r), 0),
        bosses,
        phase: Math.max(...runs.map((r) => r.boss_detail?.phase ?? 0)) || null,
        retries,
        tries,
        open,
        seconds: runs.reduce((n, r) => n + r.seconds, 0),
        character: runs[0].character,
        ladder: runs[0].ladder,
      };
    })
    .sort((a, b) => b.start - a.start);
}

/**
 * A finished fight in the live boss panel's terms (Session's "last run" between games): its kill
 * or how far it got, against the fastest and median kill of the boss at its tier before it.
 */
export function fightAsLive(f: Fight, earlier: Fight[]): BossFight {
  const enc = encounterOf(f.boss);
  const times = earlier
    .filter((e) => e.boss === f.boss && (!enc?.tiered || e.tier === f.tier) && e.start < f.start && e.killSeconds !== null)
    .map((e) => e.killSeconds!);
  const order = enc?.bosses ?? [];
  return {
    name: f.boss,
    tier: f.tier,
    tiered: !!enc?.tiered,
    retries: f.retries,
    seconds: f.killSeconds ?? f.seconds,
    killed: f.killSeconds,
    over: !f.open,
    inArena: false,
    entries: f.tries,
    deaths: f.deaths,
    bosses: Object.entries(f.bosses)
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([name, hp]) => ({ name, hp: f.killSeconds !== null ? 0 : hp, low: f.killSeconds !== null ? 0 : hp })),
    phase: f.phase,
    best: times.length ? Math.min(...times) : null,
    median: median(times),
  };
}

// ---------------------------------------------------------------- small parts

/** "T2" before the encounter's name, as Maps puts "T3" before a map's. */
function TierTag({ boss, tier }: { boss: string; tier: number | null }) {
  if (!encounterOf(boss)?.tiered) return null;
  return tier === null ? (
    <span className="text-xs text-faint" title="The summon wasn't captured, so its tier is unknown">
      T?
    </span>
  ) : (
    <span className="text-xs text-muted">T{tier}</span>
  );
}

/** A boss's health bar at the lowest it got: red, as the game draws a boss's life. */
function HpBar({ hp, name }: { hp: number; name?: string | null }) {
  return (
    <span className="flex items-center gap-1.5">
      {name && <span className="text-xs text-muted">{name}</span>}
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-line" aria-hidden>
        <span className="block h-full rounded-full bg-q-red" style={{ width: `${hp}%` }} />
      </span>
      <span className="text-xs text-text tabular-nums">
        {hp}%<span className="sr-only"> of {name ?? 'its'} life left at the lowest</span>
      </span>
    </span>
  );
}

/** How far a fight got without a kill, in a line: the HP bar, the bosses down, or the arena reached. */
function ProgressLine({ f }: { f: Fight }) {
  const p = progressOf(f);
  if (p.count === null && p.hp === null) return <span className="text-xs text-faint">no hits seen</span>;
  if (p.hp === null) return <span className="text-xs text-muted">{p.count}</span>;
  if (p.count === null) return <HpBar hp={p.hp} />;
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted">{p.count}</span>
      <HpBar hp={p.hp} name={p.name} />
    </span>
  );
}

/** The kill time in the colour map boss kills use; otherwise how far it got, "failed" as a tag after. */
function Result({ f }: { f: Fight }) {
  if (f.killSeconds !== null)
    return (
      <span className="flex items-center gap-1 text-sm text-q-set">
        <EventIcon kind="boss" className="text-q-set" title={`${f.boss} killed`} />
        <span className="tabular-nums">{fmtClock(f.killSeconds)}</span>
        <span className="sr-only">after the summon</span>
      </span>
    );
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {f.open ? <span className="text-xs text-q-set">live</span> : <ProgressLine f={f} />}
      {!f.open && <span className="text-xs text-q-red/80">failed</span>}
    </span>
  );
}

const TRY_LABEL: Record<Try, string> = { died: 'died', killed: 'killed it', left: 'left alive', live: 'in progress' };

/**
 * Tier 0 and Uber Tristram: one pip per entry, in order. Died is a red dot, the kill a green one,
 * leaving with the boss alive a marble ring; unused entries stay faint outlines. "2/4"
 * beside them, and every entry spelled out for screen readers.
 */
function Tries({ f }: { f: Fight }) {
  if (!f.retries)
    return (
      <span className="text-xs text-faint" title="No re-entry at this tier: one entry, one life">
        1 life
      </span>
    );
  const used = f.tries.length;
  const label = `${used} of ${TRIES} entries used${used ? `: ${f.tries.map((t, i) => `${i + 1} ${TRY_LABEL[t]}`).join(', ')}` : ''}`;
  return (
    <span className="flex items-center gap-1.5" role="img" aria-label={label} title={label}>
      <span className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: Math.max(TRIES, used) }, (_, i) => {
          const t = f.tries[i];
          const look =
            t === 'died' ? 'bg-q-red' : t === 'killed' ? 'bg-q-set' : t === 'left' ? 'border-[1.5px] border-text' : t === 'live' ? 'bg-q-set/50' : 'border border-faint/50';
          return <span key={i} className={`size-2 rounded-full ${look}`} />;
        })}
      </span>
      <span className="text-xs text-muted tabular-nums" aria-hidden>
        {used}/{TRIES}
      </span>
    </span>
  );
}

/** The columns of a fight row: started, encounter, result, entries, deaths, delete. */
const FIGHT_COLUMNS =
  'flex flex-wrap gap-x-4 gap-y-1 md:grid md:grid-cols-[6.5rem_minmax(10rem,1fr)_minmax(13rem,1.3fr)_6rem_3.5rem_0.75rem]';

type Head = (key: FightSort | null, text: string, align?: string) => React.ReactNode;

function FightHeader({ head }: { head?: Head }) {
  const h: Head = head ?? ((_, text, align = 'text-right') => <span className={align}>{text}</span>);
  return (
    <div className={`${FIGHT_COLUMNS} hidden border-b border-line/60 px-4 py-1.5 text-xs ${head ? 'text-muted' : 'text-faint'} md:grid`}>
      {h('newest', 'Started', 'text-left')}
      {h(null, 'Encounter · notable', 'text-left')}
      {h('closest', 'Result', 'text-left')}
      {h(null, 'Entries', 'text-left')}
      {h('deaths', 'Deaths')}
      <span />
    </div>
  );
}

function FightRow({
  f,
  character,
  grail,
  focused = false,
}: {
  f: Fight;
  character?: { name: string; cls: string | null; ladder: boolean | null };
  grail: Set<string>;
  focused?: boolean;
}) {
  const focusRow = useFocusedRow(focused);
  const values = useValues();
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const finds = f.runs.flatMap((r) =>
    r.items
      .map((i) => ({ i, isNew: grail.has(`${r.id}|${captureName(i)}`) }))
      .filter(({ i, isNew }) => isNew || isNotableFind(i, values)),
  );
  const p = progressOf(f);
  // Several bosses, not all down: each one's bar under the row.
  const perBoss = f.killSeconds === null && p.name !== null && Object.keys(f.bosses).length > 1;
  const order = encounterOf(f.boss)?.bosses ?? [];
  const when = startFmt.format(f.start);
  const remove = async () => {
    if (!confirm(`Delete the ${f.boss} fight from ${when}${f.runs.length > 1 ? ` (${f.runs.length} games)` : ''}?\n\nIt no longer counts on Bossing. The data is backed up first.`)) return;
    setDeleteError(null);
    try {
      for (const r of f.runs) await deleteRun(r.id);
    } catch (e) {
      setDeleteError((e as Error).message);
    }
  };
  return (
    <div ref={focusRow.ref} className={`group flex flex-col gap-1.5 px-4 py-2.5 ${focusRow.mark}`}>
      <div className={`${FIGHT_COLUMNS} items-center`}>
        <span className="min-w-0 text-xs text-muted tabular-nums">
          {when}
          {character && (
            <span className="mt-0.5 flex items-center gap-1 truncate text-xs" title={character.name}>
              <ClassIcon cls={character.cls} size={14} />
              {character.name}
              {character.ladder === false && <NonLadderTag />}
            </span>
          )}
        </span>
        <span className="min-w-0">
          {encounterOf(f.boss)?.tiered && (
            <span className="mr-2">
              <TierTag boss={f.boss} tier={f.tier} />
            </span>
          )}
          <span className="text-text">{f.boss}</span>
          {f.runs.length > 1 && (
            <span className="ml-2 text-xs text-faint" title="Rejoined: games entered with this summon">
              {f.runs.length} games
            </span>
          )}
        </span>
        <Result f={f} />
        <Tries f={f} />
        <span className="flex items-center justify-end gap-0.5 text-sm tabular-nums">
          {f.deaths > 0 && (
            <>
              <EventIcon kind="death" className="text-q-red" title={`Died ${f.deaths === 1 ? 'once' : `${f.deaths} times`}`} />
              <span className="text-q-red">{f.deaths}</span>
            </>
          )}
        </span>
        <button
          className="-m-2 p-2 text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-q-red focus-visible:opacity-100 disabled:invisible"
          title={f.open ? 'Still being fought' : 'Delete this fight'}
          aria-label={`Delete the ${f.boss} fight from ${when}`}
          disabled={f.open}
          onClick={remove}
        >
          ×
        </button>
      </div>
      {deleteError && (
        <p className="text-xs text-q-red md:pl-[7.5rem]" role="alert">
          Couldn't delete this fight: {deleteError}. Try again once the app has finished starting.
        </p>
      )}
      {perBoss && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 md:pl-[7.5rem]">
          {Object.entries(f.bosses)
            .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
            .map(([name, hp]) =>
              hp === 0 ? (
                <span key={name} className="flex items-center gap-1 text-xs text-q-set">
                  {name}
                  <EventIcon kind="boss" size={14} className="text-q-set" title={`${name} killed`} />
                </span>
              ) : (
                <HpBar key={name} hp={hp} name={name} />
              ),
            )}
        </div>
      )}
      {finds.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-sm md:pl-[7.5rem]">
          {finds.map(({ i, isNew }, k) => {
            const item = i.item ?? { ...asItem(i), item_level: i.ilvl ?? undefined };
            return (
              <span
                key={k}
                className="flex cursor-help items-center gap-1"
                onMouseMove={(e) => setHover({ item, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
              >
                <ItemIcon item={item} box={20} />
                <span className={itemColor(i)}>{captureName(i)}</span>
                {i.ethereal && <span className="text-muted">eth</span>}
                {isNew && <NewMark size={13} />}
              </span>
            );
          })}
        </div>
      )}
      {hover && <FloatingTooltip {...hover} />}
    </div>
  );
}

function FightItems({ fights, characters, grail, focus = null }: { fights: Fight[]; characters: Character[]; grail: Set<string>; focus?: number | null }) {
  const byName = new Map(characters.map((c) => [c.name, c]));
  return (
    <ul>
      {fights.map((f) => (
        <li key={f.key} className="border-b border-line/60 last:border-0">
          <FightRow
            f={f}
            grail={grail}
            focused={focus !== null && f.runs.some((r) => r.id === focus)}
            character={
              characters.length && f.character
                ? { name: f.character, cls: byName.get(f.character)?.class ?? null, ladder: f.ladder ?? byName.get(f.character)?.ladder ?? null }
                : undefined
            }
          />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- By encounter

interface Stats {
  fights: number;
  kills: number;
  fastest: number | null;
  typical: number | null;
  /** The fight that got furthest without a kill. */
  closest: Fight | null;
  notable: number;
}

function statsOf(fights: Fight[], notableOf: (f: Fight) => number): Stats {
  const times = fights.map((f) => f.killSeconds).filter((s): s is number => s !== null);
  const failed = fights.filter((f) => f.killSeconds === null && !f.open && progressOf(f).rank < Infinity);
  return {
    fights: fights.length,
    kills: times.length,
    fastest: times.length ? Math.min(...times) : null,
    typical: median(times),
    closest: failed.length ? failed.reduce((a, b) => (progressOf(b).rank < progressOf(a).rank ? b : a)) : null,
    notable: fights.reduce((n, f) => n + notableOf(f), 0),
  };
}

/**
 * Every encounter, fought or not, under its header row (totals, tiers fought), with its tiers
 * (T0-T2) always listed once it's been fought. A row opens to its fights, as a map opens to its
 * runs on Maps.
 */
type EncounterSort = 'fights' | 'kills' | 'fastest' | 'typical' | 'closest' | 'notable';
const ENCOUNTER_SORTS: Sorts<EncounterSort, { stats: Stats }> = {
  fights: { of: (g) => g.stats.fights || null, low: false, label: 'fights' },
  kills: { of: (g) => (g.stats.fights ? g.stats.kills : null), low: false, label: 'kills' },
  fastest: { of: (g) => g.stats.fastest, low: true, label: 'fastest kill' },
  typical: { of: (g) => g.stats.typical, low: true, label: 'typical kill' },
  closest: { of: (g) => (g.stats.closest ? progressOf(g.stats.closest).rank : null), low: true, label: 'closest fight' },
  notable: { of: (g) => (g.stats.fights ? g.stats.notable : null), low: false, label: 'notable' },
};
const ENCOUNTER_HEADS: Record<EncounterSort, string> = { fights: 'Fights', kills: 'Kills', fastest: 'Fastest', typical: 'Typical', closest: 'Closest', notable: 'Notable' };

function EncounterList({ fights, characters, grail }: { fights: Fight[]; characters: Character[]; grail: Set<string> }) {
  const values = useValues();
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  // No column picked: the encounters in the game's order. A column sorts the encounters; each keeps its tiers in order.
  const [sort, setSort] = useState<SortState<EncounterSort>>(null);
  const notableOf = (f: Fight) => f.runs.reduce((n, r) => n + r.items.filter((i) => isNotableFind(i, values)).length, 0);
  const groups = ENCOUNTERS.map((e) => {
    const mine = fights.filter((f) => f.boss === e.name);
    const tiers: { tier: number | null; fights: Fight[] }[] = e.tiered ? TIERS.map((t) => ({ tier: t, fights: mine.filter((f) => f.tier === t) })) : [];
    const unknown = mine.filter((f) => f.tier === null);
    if (e.tiered && unknown.length) tiers.push({ tier: null, fights: unknown });
    return { ...e, fights: mine, stats: statsOf(mine, notableOf), tiers };
  });
  const toggle = (key: string) => {
    setOpen((o) => (o === key ? null : key));
    setPage(0);
  };
  const cell = 'px-3 py-2 text-right tabular-nums';
  const dash = <span className="text-muted">—</span>;
  const cells = (s: Stats) => (
    <>
      <td className={cell}>{s.fights}</td>
      <td className={cell}>{s.kills ? <span className="text-q-set">{s.kills}</span> : <span className="text-muted">0</span>}</td>
      <td className={cell}>{s.fastest !== null ? fmtClock(s.fastest) : dash}</td>
      <td className={cell}>{s.typical !== null ? fmtClock(s.typical) : dash}</td>
      <td className="px-3 py-1.5">{s.closest ? <ProgressLine f={s.closest} /> : dash}</td>
      <td className={cell}>{s.notable || dash}</td>
    </>
  );
  const COLS = 7;
  const expanded = (key: string, rows: Fight[]) => {
    if (open !== key) return null;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const at = Math.min(page, pages - 1);
    return (
      <tr className="border-t border-line">
        <td colSpan={COLS} className="bg-bg/40 p-0">
          {/* The fights have their own columns (the Log's): their own header, so no value reads as the table's. */}
          <FightHeader />
          <FightItems fights={rows.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE)} characters={characters} grail={grail} />
          {pages > 1 && (
            <div className="flex justify-end border-t border-line/60 px-4 py-2 text-xs">
              <Pager page={at} pages={pages} onPage={setPage} />
            </div>
          )}
        </td>
      </tr>
    );
  };
  // A row that opens: the ▸/▾ button carries the state for keyboard and screen readers.
  const opener = (key: string, label: React.ReactNode, n: number) =>
    n ? (
      <button className="flex items-center gap-2 text-left" aria-expanded={open === key} onClick={(e) => (e.stopPropagation(), toggle(key))}>
        <span className="inline-block w-3 text-muted" aria-hidden>
          {open === key ? '▾' : '▸'}
        </span>
        {label}
      </button>
    ) : (
      <span className="flex items-center gap-2">
        <span className="inline-block w-3" />
        {label}
      </span>
    );
  const rowClass = (key: string, n: number) => (n ? `cursor-pointer ${open === key ? 'bg-panel-hi' : 'hover:bg-panel-hi/60'}` : '');

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg text-text">Encounters</h2>
      <div className="rounded-sm border border-line bg-panel">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 text-left font-normal">
                  {sort ? (
                    <button className="hover:text-text" onClick={() => setSort(null)} title="Back to the game's order">
                      Encounter
                    </button>
                  ) : (
                    'Encounter'
                  )}
                </th>
                {(Object.keys(ENCOUNTER_SORTS) as EncounterSort[]).map((k) => (
                  <SortHead
                    key={k}
                    k={k}
                    text={ENCOUNTER_HEADS[k]}
                    sorts={ENCOUNTER_SORTS}
                    sort={sort}
                    onSort={setSort}
                    className={k === 'closest' ? 'px-3 py-2 text-left font-normal' : undefined}
                  />
                ))}
              </tr>
            </thead>
            {sortRows(groups, ENCOUNTER_SORTS, sort).map((g) => {
              const groupKey = `${g.name}|all`;
              const fought = g.tiers.filter((t) => t.tier !== null && t.fights.length).length;
              // A tiered encounter opens by its tiers; one without tiers opens itself.
              const opensItself = !g.tiered && g.fights.length > 0;
              return (
                <tbody key={g.name} className="border-b border-line/60 last:border-0">
                  <tr
                    className={`bg-panel-hi/40 ${opensItself ? rowClass(groupKey, 1) : ''}`}
                    onClick={opensItself ? () => toggle(groupKey) : undefined}
                  >
                    <th scope="rowgroup" className="px-3 py-2 text-left font-normal">
                      {opener(
                        groupKey,
                        <span className="flex items-baseline gap-2">
                          <span className={`font-semibold ${g.fights.length ? 'text-text' : 'text-muted'}`}>{g.name}</span>
                          {g.tiered && g.fights.length > 0 && (
                            <span className="text-xs text-muted">
                              {fought}/{TIERS.length} tiers fought
                            </span>
                          )}
                        </span>,
                        opensItself ? 1 : 0,
                      )}
                    </th>
                    {g.fights.length ? (
                      cells(g.stats)
                    ) : (
                      <td colSpan={COLS - 1} className="px-3 py-2 text-xs text-muted">
                        Not fought yet
                      </td>
                    )}
                  </tr>
                  {opensItself && expanded(groupKey, g.fights)}
                  {g.fights.length > 0 &&
                    g.tiers.map((t) => {
                      const key = `${g.name}|${t.tier}`;
                      return (
                        <Fragment key={key}>
                          <tr className={`border-t border-line/40 ${rowClass(key, t.fights.length)}`} onClick={t.fights.length ? () => toggle(key) : undefined}>
                            <th scope="row" className="py-1.5 pr-3 pl-8 text-left font-normal">
                              {opener(
                                key,
                                <span className={t.fights.length ? 'text-text' : 'text-muted'}>
                                  {t.tier === null ? 'Tier unknown' : `T${t.tier}`}
                                  <span className="sr-only"> {g.name}</span>
                                </span>,
                                t.fights.length,
                              )}
                            </th>
                            {t.fights.length ? (
                              cells(statsOf(t.fights, notableOf))
                            ) : (
                              <td colSpan={COLS - 1} className="px-3 py-1.5 text-xs text-muted">
                                Not fought yet
                              </td>
                            )}
                          </tr>
                          {expanded(key, t.fights)}
                        </Fragment>
                      );
                    })}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>
      {/* The column definitions, in words rather than hover text (as on Maps). */}
      <p className="text-xs text-muted">
        Kill times run from the summon to the kill, deaths and rejoins included · Typical: median kill · Closest: the furthest a fight got without
        a kill · Notable: tiered items, Pul+ runes and valuable currency
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- Log

type FightSort = 'newest' | 'closest' | 'deaths';
const SORTS: Record<FightSort, { label: string; of: (f: Fight) => number; desc: boolean }> = {
  newest: { label: 'Newest', of: (f) => f.start, desc: true },
  // Kills first, fastest first, then the fights that got closest.
  closest: { label: 'Result', of: (f) => (f.killSeconds !== null ? f.killSeconds - 1e9 : Math.min(progressOf(f).rank, 1e9)), desc: false },
  deaths: { label: 'Deaths', of: (f) => f.deaths, desc: true },
};

interface FightFilter {
  /** '0' | '1' | '2' | 'untiered' */
  tiers: string[];
  encounter: string;
  outcome: '' | 'killed' | 'failed' | 'live';
  character: string;
  sort: FightSort;
  reversed: boolean;
}
const NO_FILTER: FightFilter = { tiers: [], encounter: '', outcome: '', character: '', sort: 'newest', reversed: false };
const tierKey = (f: Fight) => (encounterOf(f.boss)?.tiered ? String(f.tier ?? '?') : 'untiered');

function useFightFilter() {
  const [filter, setFilter] = useState<FightFilter>(() => {
    try {
      return { ...NO_FILTER, ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}') };
    } catch {
      return NO_FILTER;
    }
  });
  const update = (change: Partial<FightFilter>) =>
    setFilter((f) => {
      const next = { ...f, ...change };
      try {
        localStorage.setItem(FILTER_KEY, JSON.stringify(next));
      } catch {
        // storage blocked: the filter lasts until reload
      }
      return next;
    });
  return [filter, update] as const;
}

function FightLog({ fights, characters, grail, focus }: { fights: Fight[]; characters: Character[]; grail: Set<string>; focus: number | null }) {
  const [saved, update] = useFightFilter();
  // The character filter only applies while several characters' fights are listed.
  const filter = characters.length > 1 ? saved : { ...saved, character: '' };
  const [page, setPage] = useState(0);
  const set = (change: Partial<FightFilter>) => {
    update(change);
    setPage(0);
  };
  const shown = useMemo(() => {
    const desc = SORTS[filter.sort].desc !== filter.reversed;
    const of = SORTS[filter.sort].of;
    return fights
      .filter(
        (f) =>
          (!filter.tiers.length || filter.tiers.includes(tierKey(f))) &&
          (!filter.encounter || f.boss === filter.encounter) &&
          (!filter.character || f.character === filter.character) &&
          (!filter.outcome ||
            (filter.outcome === 'killed' ? f.killSeconds !== null : filter.outcome === 'live' ? f.open : f.killSeconds === null && !f.open)),
      )
      .sort((a, b) => (desc ? of(b) - of(a) : of(a) - of(b)) || b.start - a.start);
  }, [fights, filter]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const at = Math.min(page, pages - 1);
  // A linked fight (by any of its runs): to its page, clearing a filter that hides it.
  const holds = (f: Fight) => f.runs.some((r) => r.id === focus);
  useFocusOnce(focus, fights.some(holds), () => {
    let i = shown.findIndex(holds);
    if (i < 0) {
      set({ ...NO_FILTER, sort: filter.sort, reversed: filter.reversed });
      const desc = SORTS[filter.sort].desc !== filter.reversed;
      const of = SORTS[filter.sort].of;
      i = [...fights].sort((a, b) => (desc ? of(b) - of(a) : of(a) - of(b)) || b.start - a.start).findIndex(holds);
    }
    setPage(Math.floor(Math.max(0, i) / PAGE_SIZE));
  });
  const filtered = filter.tiers.length > 0 || !!filter.encounter || !!filter.outcome || !!filter.character;
  const tierOptions = [
    ...TIERS.map((t) => ({ key: String(t), label: `T${t}`, count: fights.filter((f) => tierKey(f) === String(t)).length })),
    { key: 'untiered', label: 'Untiered', count: fights.filter((f) => tierKey(f) === 'untiered').length },
  ];
  const desc = SORTS[filter.sort].desc !== filter.reversed;
  const head: Head = (key, text, align = 'text-right') =>
    key === null ? (
      <span className={align}>{text}</span>
    ) : (
      <button
        className={`${align} hover:text-text ${filter.sort === key ? 'text-accent' : ''}`}
        onClick={() => set(key === filter.sort ? { reversed: !filter.reversed } : { sort: key, reversed: false })}
        title={`Sort by ${SORTS[key].label.toLowerCase()}`}
        aria-pressed={filter.sort === key}
      >
        {text}
        {filter.sort === key && <span aria-label={desc ? ' highest first' : ' lowest first'}>{desc ? ' ↓' : ' ↑'}</span>}
      </button>
    );

  return (
    <section className="flex flex-col gap-3">
      {/* One control row: heading, tier filter, then the selects (as Maps' Log). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="mr-2 text-lg text-text">Fights</h2>
        <Segmented
          label="Tier"
          total={fights.length}
          options={tierOptions}
          active={filter.tiers}
          onToggle={(t) => set({ tiers: filter.tiers.includes(t) ? filter.tiers.filter((x) => x !== t) : [...filter.tiers, t] })}
          onClear={() => set({ tiers: [] })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select className={select} value={filter.encounter} onChange={(e) => set({ encounter: e.target.value })} aria-label="Encounter">
            <option value="">All encounters</option>
            {ENCOUNTERS.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name} ({fights.filter((f) => f.boss === e.name).length})
              </option>
            ))}
          </select>
          <select className={select} value={filter.outcome} onChange={(e) => set({ outcome: e.target.value as FightFilter['outcome'] })} aria-label="Result">
            <option value="">Any result</option>
            <option value="killed">Killed</option>
            <option value="failed">Failed</option>
            <option value="live">In progress</option>
          </select>
          {characters.length > 1 && (
            <select className={select} value={filter.character} onChange={(e) => set({ character: e.target.value })} aria-label="Character">
              <option value="">All characters</option>
              {characters.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {filtered && (
            <button className="text-xs text-accent hover:underline" onClick={() => set({ ...NO_FILTER, sort: filter.sort, reversed: filter.reversed })}>
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="rounded-sm border border-line bg-panel">
        {shown.length > 0 && <FightHeader head={head} />}
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No fights match these filters.</p>
        ) : (
          <FightItems fights={shown.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE)} characters={characters} grail={grail} focus={focus} />
        )}
        {shown.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-muted">
            <span className="tabular-nums">
              {at * PAGE_SIZE + 1}–{Math.min(shown.length, (at + 1) * PAGE_SIZE)} of {shown.length}
              {shown.length < fights.length && ` (${fights.length} in this period)`}
            </span>
            {pages > 1 && <Pager page={at} pages={pages} onPage={setPage} />}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the page

type View = 'encounters' | 'log';
const VIEWS: { key: View; label: string }[] = [
  { key: 'encounters', label: 'By encounter' },
  { key: 'log', label: 'Log' },
];

/**
 * Uber boss fights (Runs → Bossing), built like Maps: totals, then By encounter (every encounter
 * and tier, each opening to its fights) or the Log (every fight, filtered and sorted). A fight is
 * one summon, across rejoins; one in progress is pinned on top.
 */
export function BossOverview({ runs: all, characters = [], focus = null }: { runs: MapRun[]; characters?: Character[]; focus?: number | null }) {
  const values = useValues();
  const fights = useMemo(() => buildFights(all), [all]);
  const bossRuns = useMemo(() => all.filter((r) => r.kind === 'boss'), [all]);
  const noChildren = useMemo(() => new Map<number, MapRun[]>(), []);
  const grail = useRunGrail(bossRuns, noChildren);
  const [mode, setMode] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'log' ? 'log' : 'encounters';
    } catch {
      return 'encounters';
    }
  });
  const pickMode = (v: View) => {
    setMode(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage blocked: the view lasts until reload
    }
  };
  // A linked fight opens in the Log (without changing the view you keep).
  useFocusOnce(focus, bossRuns.some((r) => r.id === focus), () => setMode('log'));
  // The characters with fights, most first; named on rows and filterable only when there are several.
  const chars = useMemo(() => {
    const n = new Map<string, number>();
    for (const f of fights) if (f.character) n.set(f.character, (n.get(f.character) ?? 0) + 1);
    return [...n]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([name]) => characters.find((c) => c.name === name) ?? { name, class: null, level: null, ladder: null });
  }, [fights, characters]);
  // Rows always name their character; the Log's character filter needs several to pick from.

  if (!fights.length) {
    return (
      <section className="flex flex-col gap-1 py-6">
        <h2 className="text-lg text-text">No boss fights in this period</h2>
        <p className="max-w-[62ch] text-sm text-muted">
          Lucion, Rathma, Diablo Clone, Uber Tristram and the Uber Ancients are recorded when you use their summon item. Kills, deaths and finds
          follow you across rejoins. Cube the item first to set its tier.
        </p>
      </section>
    );
  }

  const live = fights.filter((f) => f.open);
  const kills = fights.filter((f) => f.killSeconds !== null).length;
  const failed = fights.filter((f) => f.killSeconds === null && !f.open).length;
  const deaths = fights.reduce((n, f) => n + f.deaths, 0);
  const time = fights.reduce((n, f) => n + f.seconds, 0);
  const notable = bossRuns.reduce((n, r) => n + r.items.filter((i) => isNotableFind(i, values)).length, 0);

  return (
    <>
      <Ledger
        items={[
          { value: fmtNumber(fights.length), label: fights.length === 1 ? 'fight' : 'fights' },
          { value: fmtNumber(kills), label: kills === 1 ? 'kill' : 'kills' },
          { value: fmtNumber(failed), label: 'failed', title: 'Fights over without a kill' },
          { value: fmtNumber(deaths), label: deaths === 1 ? 'death' : 'deaths' },
          { value: fmtClock(time), label: 'fighting', title: 'Time inside the boss arenas' },
          { value: fmtNumber(notable), label: 'notable', title: 'Notable finds from boss fights: tiered items, Pul+ runes and valuable currency' },
        ]}
      />
      {live.length > 0 && (
        <section className="flex flex-col gap-2" aria-live="polite">
          <h2 className="text-sm text-q-set">In progress</h2>
          <div className="rounded-sm border border-line bg-panel">
            <FightItems fights={live} characters={chars} grail={grail} />
          </div>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Seg options={VIEWS} value={mode} onChange={pickMode} />
      </div>
      {mode === 'encounters' ? (
        <EncounterList fights={fights} characters={chars} grail={grail} />
      ) : (
        <FightLog fights={fights} characters={chars} grail={grail} focus={focus} />
      )}
    </>
  );
}
