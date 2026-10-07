import { Fragment, useEffect, useMemo, useState } from 'react';
import { ItemIcon } from '../components/ItemIcon';
import { FloatingTooltip } from '../components/ItemTooltip';
import { fetchGrail, markGrail, type GrailFound, type Range } from '../lib/api';
import { CATALOG, COUNTED_KEYS, REQUIRED, SLOT_ORDER, grailCounts, bases, clusterOf, pseudoItem, type Entry } from '../lib/grail';
import { useChanges } from '../lib/live';
import { fmtNumber } from '../lib/series';
import type { Item } from '../lib/types';
import { segGroup, segItem, toolbar as input } from '../lib/ui';

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const dayKey = (t: string | number) => new Date(t).toLocaleDateString('sv'); // YYYY-MM-DD, local

/** The grail in the range picked in the status strip (a season or all time), like every other tab. */
export function GrailView({ range }: { range: Range }) {
  const [found, setFound] = useState<GrailFound[] | null>(null);
  const [kind, setKind] = useState<'Unique' | 'Set'>('Unique');
  const [show, setShow] = useState<'all' | 'found' | 'missing'>('all');
  const [search, setSearch] = useState('');
  /** One item group (Helm, Ring...) or every group (null). */
  const [group, setGroup] = useState<string | null>(null);
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const version = useChanges('drops', 'sources');

  useEffect(() => {
    fetchGrail(range).then(setFound, () => {});
  }, [version, range]);

  const foundMap = useMemo(() => {
    const m = new Map<string, GrailFound>();
    for (const f of found ?? []) m.set(`${f.quality}:${f.name}`, f);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found]);

  const { Unique: uniques, Set: sets } = grailCounts(found ?? []);

  const q = search.trim().toLowerCase();
  const rank = (g: string) => (SLOT_ORDER.includes(g) ? SLOT_ORDER.indexOf(g) : 100);
  // The index: every group of this kind with its count, whatever the filters.
  const index = useMemo(() => {
    const byGroup = new Map<string, { have: number; total: number }>();
    for (const e of CATALOG) {
      if (e.quality !== kind) continue;
      const g = byGroup.get(e.group) ?? { have: 0, total: 0 };
      g.total++;
      if (foundMap.has(`${kind}:${e.name}`)) g.have++;
      byGroup.set(e.group, g);
    }
    return [...byGroup].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [kind, foundMap]);
  const groups = useMemo(() => {
    const byGroup = new Map<string, Entry[]>();
    for (const e of CATALOG) {
      if (e.quality !== kind || (group && e.group !== group)) continue;
      const have = foundMap.has(`${kind}:${e.name}`);
      if ((show === 'found' && !have) || (show === 'missing' && have)) continue;
      if (q && !e.name.toLowerCase().includes(q) && !bases[e.base_code]?.name?.toLowerCase().includes(q)) continue;
      byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
    }
    return [...byGroup].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [kind, group, show, q, foundMap]); // eslint-disable-line react-hooks/exhaustive-deps
  // Switching Uniques/Sets drops a group the other kind doesn't have.
  useEffect(() => {
    if (group && !index.some(([g]) => g === group)) setGroup(null);
  }, [index, group]);


  if (!found) return <p className="py-16 text-center text-muted">Loading…</p>;

  return (
    <>
      <section className="flex flex-wrap items-end gap-x-10 gap-y-4" aria-label="Grail progress">
        <h1 className="font-display text-5xl leading-none font-extrabold tracking-[0.02em] text-sigil uppercase">Grail</h1>
        <ProgressBar label="Uniques" have={uniques.have} total={uniques.total} color="bg-q-unique" />
        <ProgressBar label="Sets" have={sets.have} total={sets.total} color="bg-q-set" />
        <ProgressBar label="Together" have={uniques.have + sets.have} total={uniques.total + sets.total} color="bg-sigil" />
      </section>
      <Highlights found={found} />
      <div className="flex flex-wrap gap-2">
        <div className={segGroup} role="group">
          <button className={segItem(kind === 'Unique')} aria-pressed={kind === 'Unique'} onClick={() => setKind('Unique')}>
            Uniques
          </button>
          <button className={segItem(kind === 'Set')} aria-pressed={kind === 'Set'} onClick={() => setKind('Set')}>
            Sets
          </button>
        </div>
        <div className={segGroup} role="group">
          {(['all', 'found', 'missing'] as const).map((s) => (
            <button key={s} className={segItem(show === s)} aria-pressed={show === s} onClick={() => setShow(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <input className={`${input} min-w-0 flex-1`} placeholder="Search…" aria-label="Search the grail" value={search} onChange={(e) => setSearch(e.target.value)} data-hotkey-search />
        {/* Below md the index is this select. */}
        <select className={`${input} md:hidden`} value={group ?? ''} onChange={(e) => setGroup(e.target.value || null)} aria-label="Item group">
          <option value="">All groups</option>
          {index.map(([g, c]) => (
            <option key={g} value={g}>
              {g} {c.have}/{c.total}
            </option>
          ))}
        </select>
      </div>

      <div className="grid items-start gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
      <nav aria-label="Item groups" className="sticky top-0 hidden max-h-[calc(100dvh-7rem)] flex-col overflow-y-auto py-1 md:flex">
        {[['', { have: index.reduce((n, [, c]) => n + c.have, 0), total: index.reduce((n, [, c]) => n + c.total, 0) }] as const, ...index].map(([g, c], i, all) => {
          const on = (group ?? '') === g;
          // Uniques: a cluster heading (Armour, Weapons...) above its first group.
          const cluster = kind === 'Unique' && g && (i === 1 || clusterOf(all[i - 1][0]) !== clusterOf(g)) ? clusterOf(g) : null;
          return (
            <Fragment key={g || 'all'}>
            {cluster && <span className="mt-3 mb-0.5 px-2 font-num text-[13px] font-semibold tracking-[0.04em] text-faint uppercase">{cluster}</span>}
            <button
              aria-pressed={on}
              onClick={() => setGroup(g || null)}
              className={`flex items-baseline justify-between gap-2 rounded-sm px-2 py-1 text-left text-sm ${
                on ? 'bg-panel-hi text-text' : 'text-muted hover:bg-panel/70 hover:text-text'
              } ${g ? '' : 'mb-1 font-semibold'}`}
            >
              <span className="truncate">{g || 'All groups'}</span>
              <span className={`font-num font-semibold tabular-nums ${c.have === c.total ? 'text-sigil' : 'text-faint'}`}>
                {c.have}/{c.total}
              </span>
            </button>
            </Fragment>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-col gap-5" onMouseLeave={() => setHover(null)}>
        {groups.length === 0 && <p className="py-6 text-sm text-muted">Nothing matches.</p>}
        {groups.map(([group, entries]) => {
          const have = entries.filter((e) => foundMap.has(`${kind}:${e.name}`)).length;
          return (
            <section key={group}>
              <h2 className="mb-1 flex items-baseline gap-3 border-b border-line pb-1 text-base text-text">
                <span>{group}</span>
                <span className={`font-num font-semibold tabular-nums ${have === entries.length ? 'text-sigil' : 'text-muted'}`}>
                  {have}/{entries.length}
                </span>
              </h2>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-4">
                {entries.map((e) => {
                  const f = foundMap.get(`${kind}:${e.name}`);
                  const item = f?.item ?? pseudoItem(e);
                  return (
                    <li
                      key={e.name}
                      className="group flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-panel-hi"
                      onMouseMove={(ev) => setHover({ item, x: ev.clientX, y: ev.clientY })}
                    >
                      <span className={f ? '' : 'opacity-30 grayscale'}>
                        <ItemIcon item={item} box={32} />
                      </span>
                      <div className="min-w-0">
                        <div className={`truncate text-sm ${f ? `font-semibold ${kind === 'Unique' ? 'text-q-unique' : 'text-q-set'}` : 'text-faint'}`}>{e.name}</div>
                        <div className={`truncate text-xs ${f ? 'text-muted' : 'text-faint'}`} title={f?.baseline ? 'Marked as found by you' : undefined}>
                          {/* The base always; when it was found as a faint suffix. */}
                          {bases[e.base_code]?.name}
                          {f && <span className="text-faint"> · {f.baseline ? 'marked' : dateFmt.format(new Date(f.found_at))}</span>}
                        </div>
                      </div>
                      {/* Backfill: finds from before tracking, or outside the capture, are marked by hand. A find the capture saw stays. */}
                      {(!f || f.baseline) && (
                        <button
                          className="ml-auto shrink-0 rounded-sm px-1.5 py-0.5 text-xs text-faint opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-line hover:text-text"
                          onClick={() => markGrail(kind, e.name, !f).catch(() => {})}
                        >
                          {f ? 'Unmark' : 'Mark found'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {hover && <FloatingTooltip {...hover} />}
      </div>
      </div>
    </>
  );
}

/** "Uniques 128/450 28.4%" over a square bar. */
function ProgressBar({ label, have, total, color }: { label: string; have: number; total: number; color: string }) {
  const pct = total ? (have / total) * 100 : 0;
  return (
    <div className="flex w-48 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">{label}</span>
        <span className="font-num text-lg font-semibold tabular-nums">
          {have}
          <span className="text-sm text-muted">/{total}</span>
          <span className="ml-2 text-sm text-muted">{pct.toFixed(1)}%</span>
        </span>
      </div>
      <div className="h-1 bg-panel-hi" role="progressbar" aria-valuenow={have} aria-valuemax={total} aria-label={label}>
        <div className={`h-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

interface Milestone {
  t: string;
  label: string;
}

/** Milestones (grail counts, completed sets, first high runes) and personal records. */
/** Latest find, best day and milestones: one line under the progress bars, the milestones on demand. */
function Highlights({ found }: { found: GrailFound[] }) {
  const milestones: Milestone[] = [];
  const baseline = found.filter((f) => f.baseline && COUNTED_KEYS.has(`${f.quality}:${f.name}`));
  const finds = found.filter((f) => !f.baseline && COUNTED_KEYS.has(`${f.quality}:${f.name}`)).sort((a, b) => a.found_at.localeCompare(b.found_at));
  // Marks are a backfill, not finds: they raise the counts below (and can complete a set) but make no count milestone of their own.

  const steps = [10, 25, 50, 75, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550];
  const totalCatalog = REQUIRED.Unique + REQUIRED.Set;
  finds.forEach((f, i) => {
    const count = baseline.length + i + 1;
    if (steps.includes(count)) milestones.push({ t: f.found_at, label: `${count} grail items found` });
    for (const pct of [25, 50, 75, 100]) {
      if (count === Math.ceil((totalCatalog * pct) / 100)) milestones.push({ t: f.found_at, label: `Grail ${pct}% complete` });
    }
  });

  // Completed sets: every item of the set found or marked; dated by the last missing piece.
  const setItems = new Map<string, string[]>();
  for (const e of CATALOG) if (e.quality === 'Set') setItems.set(e.group, [...(setItems.get(e.group) ?? []), e.name]);
  const setFound = new Map(found.filter((f) => f.quality === 'Set').map((f) => [f.name, f.found_at]));
  for (const [set, names] of setItems) {
    if (names.every((n) => setFound.has(n))) milestones.push({ t: names.map((n) => setFound.get(n)!).sort().at(-1)!, label: `Completed ${set}` });
  }

  milestones.sort((a, b) => b.t.localeCompare(a.t));

  // Grail per day; drop and rune records live on Activity.
  const byDay = new Map<string, number>();
  for (const f of finds) byDay.set(dayKey(f.found_at), (byDay.get(dayKey(f.found_at)) ?? 0) + 1);
  const top = [...byDay].sort(([, a], [, b]) => b - a)[0];

  const latest = finds.at(-1);
  const day = (k: string) => dateFmt.format(new Date(`${k}T12:00`));
  return (
    <section className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm" aria-label="Grail finds">
      {latest ? (
        <span>
          <span className="text-muted">Latest find</span>{' '}
          <span className={`font-semibold ${latest.quality === 'Set' ? 'text-q-set' : 'text-q-unique'}`}>{latest.name}</span>{' '}
          <span className="text-muted">{dateFmt.format(new Date(latest.found_at))}</span>
        </span>
      ) : (
        <span className="text-muted">No grail finds in this period yet</span>
      )}
      {top && (
        <span>
          <span className="text-muted">Most in a day</span> <span className="font-num text-base font-semibold tabular-nums">{fmtNumber(top[1])}</span>{' '}
          <span className="text-muted">{day(top[0])}</span>
        </span>
      )}
      {milestones.length > 0 && (
        <details className="group basis-full">
          <summary className="w-fit cursor-pointer text-muted hover:text-text">
            <span className="text-text">{milestones[0].label}</span> {dateFmt.format(new Date(milestones[0].t))}
            {milestones.length > 1 && <span className="ml-2 text-accent group-open:hidden">all {milestones.length} milestones</span>}
          </summary>
          <ol className="mt-2 max-w-xl rounded-sm border border-line bg-panel">
            {milestones.map((m, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 border-b border-line/60 px-4 py-2 last:border-0">
                <span className="text-text">{m.label}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">{dateFmt.format(new Date(m.t))}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
