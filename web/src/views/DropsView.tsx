import { useEffect, useMemo, useState } from 'react';
import { CharacterPicker } from '../components/CharacterPicker';
import { DropList, type DropTrade } from '../components/DropList';
import { HaulHero } from '../components/HaulHero';
import { SlamList } from '../components/SlamList';
import { TierEditor } from '../components/TierEditor';
import { Seg } from '../components/Seg';
import { Summary } from '../components/Summary';
import { fetchCharacters, fetchDrops, fetchGrail, fetchSlams, setDropPin, type SlamStats, fetchListings, rangeParams, setDropIgnored, setDropKept, type Range } from '../lib/api';
import { useChanges } from '../lib/live';
import { awaitsDecision, isNotable } from '../lib/rank';
import { tierOf } from '../lib/tiers';
import { useValues } from '../lib/values';
import { GROUPS, itemGroup, type Group } from '../lib/itemStyle';
import { PUL, RUNE_NAMES, TIER_RANGE, runeNumber } from '../lib/runes';
import type { CharacterInfo, Drop } from '../lib/types';
import { subnav, toolbar as input } from '../lib/ui';

const MIN_RUNE_KEY = 'pd2lt.minRune';
const SHOW_ALL_KEY = 'pd2lt.showAllDrops';

function loadMinRune(): number {
  try {
    const v = Number(localStorage.getItem(MIN_RUNE_KEY));
    if (v >= 1 && v <= 33) return v;
  } catch {}
  return PUL;
}

/**
 * Haul | Currency | Tiers: what dropped, how often currency drops, and the tiers that decide what
 * the haul shelf, the rows' stripes and the overlay pick out. `className` replaces the row's own
 * look when the tabs sit in a row with controls (Currency).
 */
export function DropsTabs({ page, className = subnav }: { page: 'haul' | 'currency' | 'tiers'; className?: string }) {
  return (
    <nav className={className} aria-label="Drops">
      {(
        [
          ['haul', 'Haul', '#drops'],
          ['currency', 'Currency', '#drops/currency'],
          ['tiers', 'Tiers', '#drops/tiers'],
        ] as const
      ).map(([key, label, href]) => (
        <a
          key={href}
          href={href}
          aria-current={page === key ? 'page' : undefined}
          className={`-mb-px border-b-2 px-3 py-1.5 ${page === key ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

/** Drops → Tiers: the tier editor, with the grail's finds marked. */
export function TiersView() {
  const [found, setFound] = useState<Set<string>>(new Set());
  const version = useChanges('drops');
  useEffect(() => {
    fetchGrail().then((g) => setFound(new Set(g.map((f) => `${f.quality}:${f.name}`))), () => {});
  }, [version]);
  return (
    <>
      <DropsTabs page="tiers" />
      <TierEditor found={found} />
    </>
  );
}

export function DropsView({ range, title }: { range: Range; title: string }) {
  const [drops, setDrops] = useState<Drop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Set<Group>>(new Set());
  const [search, setSearch] = useState('');
  const [character, setCharacter] = useState('');
  const [minRune, setMinRune] = useState(loadMinRune);
  const [showIgnored, setShowIgnored] = useState(false);
  /** Show → Grail finds: only first-time grail finds, notable or not. */
  const [grailOnly, setGrailOnly] = useState(false);
  const [slamsOpen, setSlamsOpen] = useState(false);
  const [showAll, setShowAll] = useState(() => {
    try {
      return localStorage.getItem(SHOW_ALL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [newFinds, setNewFinds] = useState<Set<number>>(new Set());
  const version = useChanges('drops');

  useEffect(() => {
    try {
      localStorage.setItem(MIN_RUNE_KEY, String(minRune));
      localStorage.setItem(SHOW_ALL_KEY, showAll ? '1' : '0');
    } catch {}
  }, [minRune, showAll]);

  useEffect(() => {
    let cancelled = false;
    fetchDrops(range, true)
      .then((d) => !cancelled && (setDrops(d), setError(null)))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [range, version]);

  // All-time first finds: which drops were new for the grail.
  useEffect(() => {
    fetchGrail().then((g) => setNewFinds(new Set(g.flatMap((f) => (f.drop_id === null ? [] : [f.drop_id])))), () => {});
  }, [version]);

  // Listed or sold drops get a tag instead of "Sell…". Ids are bigints, i.e. strings.
  const [trade, setTrade] = useState<Map<string, DropTrade>>(new Map());
  const listingsVersion = useChanges('listings');
  useEffect(() => {
    fetchListings().then(({ listings }) => {
      const map = new Map<string, DropTrade>();
      for (const l of listings) {
        if (l.drop_id === null) continue;
        if (l.outcome === 'sold') map.set(String(l.drop_id), { sold: true, hr: l.sold_hr! });
        else if (!l.removed_at && !l.outcome && !map.has(String(l.drop_id))) map.set(String(l.drop_id), { sold: false });
      }
      setTrade(map);
    }, () => {});
  }, [listingsVersion]);

  const values = useValues();
  const ignoredCount = (drops ?? []).filter((d) => d.ignored && (!character || d.character === character)).length;

  // Pinning to a haul card replaces whatever this period had pinned there.
  async function onPin(drop: Drop, slot: number | null) {
    const unpin = slot === null ? [] : (drops ?? []).filter((d) => d.pin_slot === slot && d.id !== drop.id).map((d) => d.id);
    const pinnedAt = new Date().toISOString();
    setDrops(
      (prev) =>
        prev?.map((d) =>
          d.id === drop.id ? { ...d, pin_slot: slot, pinned_at: slot === null ? null : pinnedAt } : unpin.includes(d.id) ? { ...d, pin_slot: null, pinned_at: null } : d,
        ) ?? prev,
    );
    await setDropPin(drop.id, slot, unpin).catch((e) => setError(String(e)));
  }

  async function onKeep(drop: Drop, kept: boolean) {
    setDrops((prev) => prev?.map((d) => (d.id === drop.id ? { ...d, kept } : d)) ?? prev);
    await setDropKept(drop.id, kept).catch((e) => setError(String(e)));
  }

  async function onIgnore(drop: Drop, ignored: boolean) {
    setDrops((prev) => prev?.map((d) => (d.id === drop.id ? { ...d, ignored, ...(ignored && { pin_slot: null, pinned_at: null }) } : d)) ?? prev);
    await setDropIgnored(drop.id, ignored).catch((e) => setError(String(e)));
  }

  const [slams, setSlams] = useState<SlamStats | null>(null);
  // The range picked at the top (a season or all time), named as the haul title names it.
  const scopeText = title === 'All-time haul' ? 'of all time' : `in the ${title.replace(/ haul$/, '')} season`;
  useEffect(() => {
    fetchSlams(range).then(setSlams, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.since?.getTime(), range.until?.getTime(), version]);

  // Class and level for the character switch, most recently played first.
  const [known, setKnown] = useState<CharacterInfo[]>([]);
  const statsVersion = useChanges('stats');
  useEffect(() => {
    fetchCharacters().then(setKnown, () => {});
  }, [statsVersion]);
  const characters = useMemo(() => {
    const names = [...new Set((drops ?? []).map((d) => d.character).filter((c): c is string => !!c))];
    const rank = (n: string) => {
      const i = known.findIndex((c) => c.name === n);
      return i < 0 ? known.length : i;
    };
    return names
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((name) => known.find((c) => c.name === name) ?? { name, class: null, level: null });
  }, [drops, known]);

  // Summary counts respect the character/search/rune filters but not the group filter itself.
  const { scoped, hiddenRunes } = useMemo(() => {
    const q = search.trim().toLowerCase();
    let hiddenRunes = 0;
    const scoped = (drops ?? []).filter((d) => {
      if (d.ignored) return false;
      if (character && d.character !== character) return false;
      if (q && !d.item.name.toLowerCase().includes(q) && !d.item.base?.name.toLowerCase().includes(q)) return false;
      // Notable (rank.ts), plus two kinds listed but not counted: crafts waiting for Keep / Discard and
      // first-time grail finds that aren't notable. Runes go by the rune filter below.
      const tier = tierOf(d.item, values);
      if (grailOnly) {
        if (!newFinds.has(d.id)) return false;
      } else if (!showAll && !isNotable(d, 1, tier) && !awaitsDecision(d, tier) && !newFinds.has(d.id)) return false;
      const rune = runeNumber(d.item);
      if (rune !== null && rune < minRune) {
        hiddenRunes += d.quantity;
        return false;
      }
      return true;
    });
    return { scoped, hiddenRunes };
  }, [drops, character, search, minRune, showAll, values, grailOnly, newFinds]);

  const isCounted = (d: Drop) => {
    if (showAll || grailOnly) return true;
    const tier = tierOf(d.item, values);
    return !awaitsDecision(d, tier) && isNotable(d, 1, tier);
  };
  const counted = scoped.filter(isCounted);
  const counts = useMemo(() => {
    const c = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
    // Undecided crafts and non-notable grail finds are listed but not counted.
    for (const d of counted) c[itemGroup(d.item)] += d.quantity;
    return c;
  }, [counted]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = groups.size ? scoped.filter((d) => groups.has(itemGroup(d.item))) : scoped;
  const listed = showIgnored
    ? [...visible, ...(drops ?? []).filter((d) => d.ignored)].sort((a, b) => b.found_at.localeCompare(a.found_at))
    : visible;

  // Rune tiers entirely below the threshold can never have drops, so drop their tiles.
  // and with only notable drops listed, groups that can't occur (sets, rares, gems...) go too.
  const shownGroups = GROUPS.filter(
    (g) =>
      !(g === 'LowRune' && minRune > TIER_RANGE.Low[1]) &&
      !(g === 'MidRune' && minRune > TIER_RANGE.Mid[1]) &&
      // Empty kinds give way in every Show mode (unless picked); currency and rune tiers stay as the notable
      // kinds, except under Grail finds, which only ever holds uniques and sets.
      (counts[g] > 0 || groups.has(g) || (!grailOnly && (g === 'Currency' || g.endsWith('Rune')))),
  );

  const toggle = (g: Group) =>
    setGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });


  // One toolbar (kind, search, runes, character), pinned with the day heading while the list scrolls.
  const toolbar = (
    <>
      {/* The kinds get their own row in every Show mode: four or eleven of them, the toolbar keeps its shape. */}
      {drops === null ? (
        <div className="h-[42px] basis-full animate-pulse rounded-sm border border-line bg-panel/60" aria-busy="true" />
      ) : (
      <div className="basis-full">
      <Summary
        groups={shownGroups}
        counts={counts}
        total={counted.reduce((n, d) => n + d.quantity, 0)}
        active={groups}
        onToggle={toggle}
        onClear={() => setGroups(new Set())}
        scope={title === 'All-time haul' ? 'All time' : title.replace(/ haul$/, ' season')}
      />
      </div>
      )}
        <input
          className={`${input} min-w-48 flex-1 self-stretch`}
          placeholder="Search items…  ( / )"
          aria-label="Search drops"
          type="search"
          data-hotkey-search
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className={`${input} flex items-center gap-2 self-stretch`}>
          <span className="text-muted">Runes</span>
          <select
            className="bg-transparent outline-none"
            value={minRune}
            onChange={(e) => setMinRune(Number(e.target.value))}
            title={hiddenRunes > 0 ? `${hiddenRunes} rune${hiddenRunes === 1 ? '' : 's'} below ${RUNE_NAMES[minRune - 1]} hidden` : undefined}
          >
            {RUNE_NAMES.map((name, i) => (
              <option key={name} value={i + 1} className="bg-panel">
                {i === 0 ? 'All' : `${name}+`}
              </option>
            ))}
          </select>
        </label>
        {characters.length > 1 && <CharacterPicker characters={characters} value={character} onChange={setCharacter} all />}
    </>
  );

  return (
    <>
      <DropsTabs page="haul" />
      {error && (
        <div className="rounded-sm border border-q-red/50 bg-q-red/10 px-3 py-2 text-sm text-q-red" role="alert">
          Couldn't load drops from the Horazon server ({error.replace(/^Error: /, '')}). It may still be starting; this page retries when new data arrives.
        </div>
      )}

      <HaulHero
        title={title}
        drops={(drops ?? []).filter((d) => !d.ignored)}
        newFinds={newFinds}
        minRune={minRune}
        onPin={onPin}
        slams={slams}
        slamsOpen={slamsOpen}
        onSlams={() => setSlamsOpen((v) => !v)}
        scope={title === 'All-time haul' ? 'of all time' : 'this season'}
      />
      {slamsOpen && slams && slams.slams > 0 && (
        <section className="flex flex-col gap-2" aria-label="Slams">
          <p className="text-sm text-muted">Every cube corruption {scopeText}, on any item.</p>
          <div className="rounded-sm border border-line bg-panel">
            <SlamList slams={slams.list} />
          </div>
        </section>
      )}

      {drops === null && !error ? (
        <>
          <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
          <div className="h-64 animate-pulse rounded-sm border border-line bg-panel/60" aria-busy="true" />
        </>
      ) : (
        <DropList
          drops={listed}
          toolbar={toolbar}
          counted={isCounted}
          unit={grailOnly ? ['grail find', 'grail finds'] : showAll ? ['drop', 'drops'] : ['notable', 'notable']}
          onIgnore={onIgnore}
          onKeep={onKeep}
          newFinds={newFinds}
          trade={trade}
          onPin={onPin}
          aside={
            // What the list holds: a visible switch, right-aligned so the day's count text can't move it.
            <div className="ml-auto">
            <Seg
              options={[
                { key: 'notable', label: 'Notable' },
                ...((drops ?? []).some((d) => newFinds.has(d.id)) ? [{ key: 'grail' as const, label: 'Grail finds' }] : []),
                { key: 'all', label: 'Every drop' },
                ...(ignoredCount > 0 ? [{ key: 'ignored' as const, label: 'With ignored' }] : []),
              ]}
              value={showIgnored ? 'ignored' : grailOnly ? 'grail' : showAll ? 'all' : 'notable'}
              onChange={(v) => {
                setShowAll(v === 'all' || v === 'ignored');
                setShowIgnored(v === 'ignored');
                setGrailOnly(v === 'grail');
              }}
            />
            </div>
          }
        />
      )}
      <p className="text-xs text-muted">
        Export the drops {scopeText} as{' '}
        <a className="text-accent hover:underline" href={`/api/export/drops.csv?${rangeParams(range)}`}>
          CSV
        </a>{' '}
        or{' '}
        <a className="text-accent hover:underline" href={`/api/export/drops.json?${rangeParams(range)}`}>
          JSON
        </a>
        .
      </p>
    </>
  );
}
