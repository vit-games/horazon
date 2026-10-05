import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { asItem } from '../lib/capture';
import { CATALOG, SLOT_ORDER, bases, clusterOf, pseudoItem } from '../lib/grail';
import { RUNE_NAMES } from '../lib/runes';
import { DEFAULT_TIERS, parseTierFile, saveTiers, tierColor, tierFile, tiersOf, type Tier, type TierConfig, type TierEntry } from '../lib/tiers';
import { useValues } from '../lib/values';
import type { Item } from '../lib/types';

/**
 * Drops → Tiers: the user's item tiers as a tier list (best on top). Items come from the
 * catalog on the left (drilldown + search) by drag and drop - one item, a selection
 * (shift/ctrl-click) or a whole group - or by pressing 1-9 over an item (0 removes it); Alt
 * makes it the eth variant, Shift+Alt the non-eth one. Chips are selected by clicking and moved
 * from the bar that appears. The search also marks chips in the tiers. Every change saves
 * itself and Ctrl+Z undoes it. Tier lists are shared as JSON files (Export / Import).
 */

type CatalogItem = { entry: TierEntry; name: string; item: Item };
type Group = { name: string; items: CatalogItem[] };
type Category = { name: string; groups: Group[] };

const baseItem = (code: string): CatalogItem => ({ entry: { kind: 'base', key: code }, name: bases[code]?.name ?? code, item: asItem({ code, quality: null, uid: null }) });
const basesWhere = (test: (type: string, code: string) => boolean) =>
  Object.entries(bases)
    .filter(([code, b]) => b.name && test(b.type ?? '', code))
    .map(([code]) => baseItem(code))
    .sort((a, b) => a.name.localeCompare(b.name));

const CATEGORIES: Category[] = (() => {
  const grailGroups = (quality: 'Unique' | 'Set') => {
    const by = new Map<string, CatalogItem[]>();
    for (const e of CATALOG) {
      if (e.quality !== quality) continue;
      const kind = quality === 'Unique' ? 'unique' : 'set';
      by.set(e.group, [...(by.get(e.group) ?? []), { entry: { kind, key: e.name }, name: e.name, item: pseudoItem(e) }]);
    }
    const rank = (g: string) => (SLOT_ORDER.includes(g) ? SLOT_ORDER.indexOf(g) : 100);
    return [...by].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([name, items]) => ({ name, items }));
  };
  const runes = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => baseItem(`r${String(to - i).padStart(2, '0')}`));
  return [
    { name: 'Uniques', groups: grailGroups('Unique') },
    { name: 'Sets', groups: grailGroups('Set') },
    {
      name: 'Runes',
      groups: [
        { name: `High runes (${RUNE_NAMES[25]}+)`, items: runes(26, 33) },
        { name: `Mid runes (${RUNE_NAMES[14]}–${RUNE_NAMES[24]})`, items: runes(15, 25) },
        { name: `Low runes (${RUNE_NAMES[0]}–${RUNE_NAMES[13]})`, items: runes(1, 14) },
      ],
    },
    {
      name: 'Misc',
      groups: [
        { name: 'Uber & keys', items: basesWhere((t, c) => ['Uber', 'UberUnique', 'Puzzlebox', 'Token', 'Torch Fragment', 'Key'].includes(t) && c !== 'key') },
        { name: 'Map currency', items: basesWhere((t) => t === 'Worldstone Shard' || t === 'Fortify Map' || t === 'Dungeon Scarab' || /^(Imbue|Upgrade|Scour|Reroll)/.test(t)) },
        { name: 'Maps', items: basesWhere((t) => /^Map T\d$/.test(t)) },
      ],
    },
  ];
})();

const ITEMS = new Map(CATEGORIES.flatMap((c) => c.groups.flatMap((g) => g.items)).map((i) => [`${i.entry.kind}:${i.entry.key}`, i]));
/** Catalog order (uniques by slot, sets, runes high to low, misc): the order chips sit in a tier. */
const ORDER = new Map([...ITEMS.keys()].map((k, i) => [k, i]));
const keyOf = (e: TierEntry) => `${e.kind}:${e.key}`;
const ETH_LABEL = (eth: boolean | undefined) => (eth === true ? 'eth' : eth === false ? 'non-eth' : null);
const plainName = (e: TierEntry) => ITEMS.get(keyOf(e))?.name ?? e.key;
const nameOf = (e: TierEntry) => plainName(e) + (ETH_LABEL(e.eth) ? ` (${ETH_LABEL(e.eth)})` : '');
/** Players' names for items, searchable like the real ones. */
const ALIASES: Record<string, string> = {
  'Harlequin Crest': 'shako', 'The Stone of Jordan': 'soj', "Griffon's Eye": 'griffs', Annihilus: 'anni', 'Hellfire Torch': 'torch',
  "Mara's Kaleidoscope": 'maras', "Bul-Kathos' Wedding Band": 'bk bkwb', "Nightwing's Veil": 'nw', 'Crown of Ages': 'coa', 'Herald of Zakarum': 'hoz',
  'Arachnid Mesh': 'arach spider', "Andariel's Visage": 'andy', "Death's Fathom": 'fathom', "Eschuta's Temper": 'eschuta', 'War Traveler': 'wt',
  "Tyrael's Might": 'tyrael', 'The Grandfather': 'gf', Windforce: 'wf', Stormshield: 'ss', 'Skin of the Vipermagi': 'viper vmagi',
  'Chance Guards': 'chancies', 'Raven Frost': 'raven', 'Wisp Projector': 'wisp', "Gheed's Fortune": 'gheeds', "Verdungo's Hearty Cord": 'dungo',
  "Thundergod's Vigor": 'tgods', 'The Oculus': 'occy', "Mang Song's Lesson": 'msl', "Death's Web": 'dweb', Homunculus: 'homu',
  "Arreat's Face": 'arreats', "Jalal's Mane": 'jalals', "Titan's Revenge": 'titans', "Highlord's Wrath": 'highlords', 'Sandstorm Trek': 'treks',
  'Shadow Dancer': 'sd', 'Lidless Wall': 'lidless', "Kira's Guardian": 'kiras', 'Vampire Gaze': 'vamp', 'Dwarf Star': 'dwarf', "Ormus' Robes": 'ormus',
  "Tal Rasha's Guardianship": 'tal armor', "Tal Rasha's Lidless Eye": 'tal orb', "Tal Rasha's Horadric Crest": 'tal mask',
  "Tal Rasha's Adjudication": 'tal ammy', "Tal Rasha's Fine-Spun Cloth": 'tal belt', Waterwalk: 'ww', "Natalya's Mark": 'nat claw',
  "Immortal King's Stone Crusher": 'ik maul',
};
const norm = (s: string) => ` ${s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()}`;
const SEARCH = new Map([...ITEMS.values()].map((i) => [i.name, `${norm(i.name)} |${norm(ALIASES[i.name] ?? '')}`]));
/** Search hits a word's start in the name or a nickname: "ber" is Ber, not Halaberd; "shako" is Harlequin Crest. */
const hit = (name: string, q: string) => q !== '' && (SEARCH.get(name) ?? norm(name)).includes(norm(q));

const byOrder = (a: TierEntry, b: TierEntry) =>
  (ORDER.get(keyOf(a)) ?? 1e9) - (ORDER.get(keyOf(b)) ?? 1e9) || a.key.localeCompare(b.key) || String(a.eth).localeCompare(String(b.eth));

/** The entry as the given variant (undefined = either); bases have no variants. */
function withEth(e: TierEntry, eth: boolean | undefined): TierEntry {
  const { eth: _, ...rest } = e;
  return eth === undefined || e.kind === 'base' ? rest : { ...rest, eth };
}
/** Alt = eth, Shift+Alt = non-eth, no Alt = as it is. */
const withMod = (e: TierEntry, ev: { altKey: boolean; shiftKey: boolean }) => (ev.altKey ? withEth(e, !ev.shiftKey) : e);
/** Does variant `a` catch every drop variant `b` does? */
const covers = (a: boolean | undefined, b: boolean | undefined) => a === undefined || a === b;

const DRAG = 'application/x-horazon-tier';
/** `chips`: dragged out of the tiers (only those can be dropped on the catalog to remove them). */
type Payload = { entries: TierEntry[]; chips?: true };

/**
 * Put entries in a tier (or nowhere, `to` = null). An item is either one Either entry or at most
 * an eth and a non-eth one, so nothing tiered is ever unreachable:
 * - Either moves the whole item (every variant leaves its tier).
 * - eth / non-eth moves that variant; an Either elsewhere keeps the other one, and meeting the
 *   other variant in the same tier merges them into Either.
 * Returns what happened, in words, and the tiers items left.
 */
function place(config: TierConfig, entries: TierEntry[], to: number | null): { config: TierConfig; placed: TierEntry[]; notes: string[]; from: string[] } {
  const tiers = config.tiers.map((t) => ({ ...t, entries: [...t.entries] }));
  const placed: TierEntry[] = [];
  const notes: string[] = [];
  const from = new Set<string>();
  for (const e of entries) {
    const k = keyOf(e);
    const find = (test: (h: TierEntry, i: number) => boolean) => tiers.flatMap((t, i) => t.entries.filter((h) => keyOf(h) === k && test(h, i)).map((h) => ({ i, h })));
    const drop = (i: number, h: TierEntry) => (tiers[i].entries = tiers[i].entries.filter((x) => x !== h));
    const leave = (i: number, h: TierEntry) => {
      drop(i, h);
      if (i === to) return;
      from.add(tiers[i].name);
      notes.push(`left ${tiers[i].name}${ETH_LABEL(h.eth) ? ` (${ETH_LABEL(h.eth)})` : ''}`);
    };
    const v = e.kind === 'base' ? undefined : e.eth;
    if (v === undefined) {
      for (const { i, h } of find((h) => (to === null ? h.eth === undefined : true))) leave(i, h);
      if (to !== null) placed.push(withEth(e, undefined));
    } else {
      for (const { i, h } of find((h) => h.eth === v)) leave(i, h);
      if (to === null) continue;
      if (find((h, i) => i === to && h.eth === undefined).length) {
        notes.push(`${tiers[to].name} already catches it as Either`);
        continue;
      }
      for (const { i, h } of find((h) => h.eth === undefined)) {
        drop(i, h);
        if (!find((h) => h.eth === !v).length) {
          tiers[i].entries.push(withEth(e, !v));
          notes.push(`${tiers[i].name} keeps the ${ETH_LABEL(!v)} one`);
        }
      }
      const other = find((h, i) => i === to && h.eth === !v)[0];
      if (other) {
        drop(other.i, other.h);
        placed.push(withEth(e, undefined));
        notes.push(`merged with the ${ETH_LABEL(!v)} one into Either`);
      } else placed.push(e);
    }
    if (to !== null && placed.length && keyOf(placed[placed.length - 1]) === k) tiers[to].entries.push(placed[placed.length - 1]);
  }
  return { config: { tiers }, placed, notes, from: [...from] };
}

/** Undo history; outside the component so it outlives a tab switch. */
const history: { current: TierConfig[] } = { current: [] };

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const chipId = (t: Tier, e: TierEntry) => `chip|${t.id}|${keyOf(e)}|${e.eth}`;
const btn = 'rounded-sm border border-line px-3 py-1 text-muted hover:text-text disabled:opacity-40 disabled:hover:text-muted';

type Hover = { entry: TierEntry; chip?: string; mouse?: true };
type HoverProps = (entry: TierEntry, chip?: string) => Record<string, unknown>;
/** Where an item sits: each variant's tier, best first. */
type Locations = Map<string, { rank: number; eth?: boolean }[]>;

export function TierEditor({ found }: { found: Set<string> }) {
  const values = useValues();
  const saved = tiersOf(values);
  const [draft, setDraft] = useState<TierConfig>(saved);
  const draftRef = useRef(draft);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const lastMerge = useRef<string | null>(null);
  const [canUndo, setCanUndo] = useState(history.current.length > 0);
  const fileInput = useRef<HTMLInputElement>(null);
  const q = search.trim().toLowerCase();

  // Follow the saved tiers (another window, a reset) while nothing here is waiting to be saved.
  useEffect(() => {
    if (!dirtyRef.current) setDraft((draftRef.current = saved));
  }, [saved]);

  const markDirty = (d: boolean) => {
    dirtyRef.current = d;
    setDirty(d);
  };
  /** Every edit goes through here: it is undoable and saves itself. `merge` folds a run of edits (typing a name) into one undo step. */
  const update = (next: TierConfig, merge?: string) => {
    if (!merge || merge !== lastMerge.current) history.current = [...history.current.slice(-99), draftRef.current];
    lastMerge.current = merge ?? null;
    setCanUndo(true);
    setDraft((draftRef.current = next));
    markDirty(true);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    lastMerge.current = null;
    setCanUndo(history.current.length > 0);
    setDraft((draftRef.current = prev));
    markDirty(true);
    setSelected(new Set());
    setNote('Undone.');
  };

  const save = async () => {
    const sent = draftRef.current;
    setSaving(true);
    setError(null);
    try {
      await saveTiers(sent);
      if (draftRef.current === sent) markDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(save, 600);
    return () => clearTimeout(t);
  }, [draft, dirty]);
  // Leaving the tab mid-wait still saves.
  useEffect(
    () => () => {
      if (dirtyRef.current) saveTiers(draftRef.current).catch(() => {});
    },
    [],
  );

  const reset = async () => {
    history.current = [...history.current.slice(-99), draftRef.current];
    setCanUndo(true);
    setDraft((draftRef.current = DEFAULT_TIERS));
    markDirty(false);
    setNote('Back to the built-in tiers. Ctrl+Z brings yours back.');
    try {
      await saveTiers(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const exportFile = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([tierFile(draft)], { type: 'application/json' }));
    a.download = 'horazon-tiers.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importFile = async (file: File) => {
    setError(null);
    try {
      const config = parseTierFile(await file.text());
      update(config);
      const items = config.tiers.reduce((n, t) => n + t.entries.length, 0);
      const unknown = config.tiers.flatMap((t) => t.entries).filter((e) => !ITEMS.has(keyOf(e))).length;
      setNote(
        `Imported ${config.tiers.length} tiers, ${items} items from "${file.name}"` + (unknown ? ` (${unknown} not in this version's item list)` : '') + '. Ctrl+Z goes back.',
      );
    } catch (e) {
      setError(`${file.name}: ${(e as Error).message}`);
    }
  };

  const locations: Locations = useMemo(() => {
    const m: Locations = new Map();
    draft.tiers.forEach((t, rank) => t.entries.forEach((e) => m.set(keyOf(e), [...(m.get(keyOf(e)) ?? []), { rank, eth: e.eth }])));
    return m;
  }, [draft]);
  /** Why an entry never applies (a better tier already catches it), or null. */
  const shadowedBy = (rank: number, e: TierEntry): string | null => {
    const better = (locations.get(keyOf(e)) ?? []).filter((v) => v.rank < rank);
    const hit = better.find((v) => covers(v.eth, e.eth)) ?? (e.eth === undefined && better.some((v) => v.eth) && better.find((v) => v.eth === false));
    return hit ? draft.tiers[hit.rank].name : null;
  };

  const sel = draft.tiers.flatMap((t, rank) => t.entries.filter((e) => selected.has(chipId(t, e))).map((e) => ({ rank, e })));

  const apply = (entries: TierEntry[], to: number | null) => {
    if (!entries.length) return;
    const { config, placed, notes, from } = place(draftRef.current, entries, to);
    update(config);
    setSelected(new Set());
    if (entries.length === 1) {
      const what = nameOf(placed[0] ?? entries[0]);
      const head = to === null ? `Removed ${what}` : placed.length ? `${what} → ${config.tiers[to].name}` : what;
      setNote(`${head}${notes.length ? `: ${notes.filter((n) => to !== null || !n.startsWith('left')).join(', ')}` : ''}.`.replace(/: \.$/, '.'));
    } else setNote(`${to === null ? 'Removed' : 'Moved'} ${entries.length} items${to === null ? '' : ` to ${config.tiers[to].name}`}${to !== null && from.length ? `, out of ${from.join(', ')}` : ''}.`);
  };
  const setVariant = (eth: boolean | undefined) => {
    const change = sel.filter(({ e }) => e.kind !== 'base' && e.eth !== eth);
    if (!change.length) return;
    let config = draftRef.current;
    const notes: string[] = [];
    for (const { rank, e } of change) {
      const res = place(place(config, [e], null).config, [withEth(e, eth)], rank);
      config = res.config;
      notes.push(...res.notes.filter((n) => !n.startsWith(`left ${config.tiers[rank].name}`)));
    }
    update(config);
    setSelected(new Set());
    const label = eth === undefined ? 'Either' : ETH_LABEL(eth);
    setNote(`${change.length === 1 ? nameOf(withEth(change[0].e, undefined)) : `${change.length} items`} now ${label}${notes.length ? `: ${notes.join(', ')}` : ''}.`);
  };
  const jump = (rank: number, e: TierEntry) => {
    const t = draft.tiers[rank];
    const id = chipId(t, e);
    setCollapsed((s) => new Set([...s].filter((x) => x !== t.id)));
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1500);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  // Searching marks chips in the tiers too; bring the first one into view.
  useEffect(() => {
    if (q) document.querySelector('[data-match]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [q]);

  // Keyboard: 1-9 puts the hovered item (or the selection) in that tier, 0 takes it out;
  // Alt / Shift+Alt as eth / non-eth. Ctrl+Z undoes, Esc clears the selection.
  const hovered = useRef<Hover | null>(null);
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    // In a field the keys type, except in the search box while the pointer is on an item
    // (find it, point at it, press its tier).
    const field = (e.target as HTMLElement).closest('input, textarea, select');
    if (field && !(field.hasAttribute('data-tier-search') && hovered.current?.mouse)) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.key === 'Escape') return setSelected(new Set());
    if (e.ctrlKey || e.metaKey) return;
    const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (!m || Number(m[1]) > draft.tiers.length) return;
    const h = hovered.current;
    const targets = h && !(h.chip && selected.has(h.chip)) ? [h.entry] : sel.map((s) => s.e);
    if (!targets.length) return;
    e.preventDefault();
    const n = Number(m[1]);
    apply(
      targets.map((t) => withMod(t, e)),
      n === 0 ? null : n - 1,
    );
    if (h?.chip) hovered.current = null; // its chip has moved away from under the pointer
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  // Items take focus too (Tab), so the number keys work without a mouse.
  const hoverProps: HoverProps = (entry, chip) => ({
    tabIndex: 0,
    onMouseEnter: () => (hovered.current = { entry, chip, mouse: true }),
    onMouseLeave: () => (hovered.current = null),
    onFocus: () => (hovered.current = { entry, chip }),
    onBlur: () => (hovered.current = null),
  });

  const setTier = (i: number, patch: Partial<Tier>, merge?: string) => update({ tiers: draft.tiers.map((t, k) => (k === i ? { ...t, ...patch } : t)) }, merge);
  const moveTier = (from: number, to: number) => {
    if (to < 0 || to >= draft.tiers.length) return;
    const tiers = [...draft.tiers];
    const [t] = tiers.splice(from, 1);
    tiers.splice(to, 0, t);
    update({ tiers });
  };
  const removeTier = (i: number) => {
    const t = draft.tiers[i];
    update({ tiers: draft.tiers.filter((_, k) => k !== i) });
    setNote(`Deleted the tier "${t.name}"${t.entries.length ? ` and its ${t.entries.length} items` : ''}. Ctrl+Z brings it back.`);
  };
  const addTier = () => update({ tiers: [...draft.tiers, { id: newId(), name: `Tier ${draft.tiers.length + 1}`, color: null, entries: [] }] });

  const onDrop = (to: number | null) => (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG);
    if (!raw) return;
    const { entries, chips } = JSON.parse(raw) as Payload;
    if (to === null && !chips) return;
    apply(
      to === null ? entries : entries.map((x) => withMod(x, e)),
      to,
    );
  };
  const onChipClick = (id: string, ev: React.MouseEvent) =>
    setSelected((s) => {
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) return s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id]);
      return s.size === 1 && s.has(id) ? new Set() : new Set([id]);
    });

  const status = error ? null : saving || dirty ? 'Saving…' : 'All changes saved';

  return (
    <div className="grid gap-4 md:grid-cols-[300px_minmax(0,1fr)]">
      <Catalog search={search} setSearch={setSearch} locations={locations} draft={draft} hoverProps={hoverProps} onDrop={onDrop(null)} onJump={jump} shadowedBy={shadowedBy} />

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <button className={btn} onClick={undo} disabled={!canUndo} title="Undo the last change (Ctrl+Z)">
            Undo
          </button>
          <button className={btn} onClick={exportFile} title="Save these tiers as a file to share">
            Export
          </button>
          <button className={btn} onClick={() => fileInput.current?.click()} title="Load tiers from a shared file (Ctrl+Z goes back)">
            Import…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importFile(file);
            }}
          />
          <button className={`${btn} hover:border-q-red/60 hover:text-q-red`} onClick={reset}>
            Reset to default
          </button>
          <span className="min-w-0 flex-1 truncate px-2 text-muted" title={note ?? undefined} aria-live="polite">
            {note}
          </span>
          {status && <span className="shrink-0 px-1 text-muted">{status}</span>}
        </div>
        {error && (
          <p className="text-sm text-q-red">
            Not saved: {error}{' '}
            <button className="underline hover:text-text" onClick={save}>
              Try again
            </button>
          </p>
        )}
        <p className="text-xs text-muted">
          Best tier on top. Drag items in, or point at one and press its tier's number (0 removes). <Kbd>Alt</Kbd> for eth, <Kbd>Shift+Alt</Kbd> for non-eth. Click chips
          to select, Shift-click for more.
        </p>

        {draft.tiers.map((t, i) => (
          <TierRow
            key={t.id}
            tier={t}
            index={i}
            count={draft.tiers.length}
            color={tierColor(draft, i)}
            found={found}
            q={q}
            collapsed={collapsed.has(t.id)}
            onCollapse={() => setCollapsed((s) => (s.has(t.id) ? new Set([...s].filter((x) => x !== t.id)) : new Set([...s, t.id])))}
            selected={selected}
            flash={flash}
            shadowedBy={(e) => shadowedBy(i, e)}
            onChange={(patch, merge) => setTier(i, patch, merge)}
            onMove={(to) => moveTier(i, to)}
            onRemove={() => removeTier(i)}
            onDrop={onDrop(i)}
            onChipClick={onChipClick}
            dragEntries={(e, id) => (selected.has(id) ? sel.map((s) => s.e) : [e])}
            onTake={(e) => apply([e], null)}
            hoverProps={hoverProps}
          />
        ))}
        <button className="self-start text-sm text-accent hover:underline" onClick={addTier}>
          + Add tier
        </button>

        {sel.length > 0 && (
          <div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-sm border border-accent/50 bg-panel-hi px-3 py-2 text-sm shadow-lg shadow-black/50">
            <span className="max-w-[12rem] shrink-0 truncate text-text">{sel.length === 1 ? nameOf(sel[0].e) : `${sel.length} selected`}</span>
            <span className="flex min-w-0 items-center gap-1 overflow-x-auto" role="group" aria-label="Move to tier">
              {draft.tiers.map((t, i) => (
                <button
                  key={t.id}
                  className="flex max-w-[9rem] shrink-0 items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-xs font-semibold hover:bg-panel disabled:opacity-35"
                  style={{ color: tierColor(draft, i) }}
                  disabled={sel.every((s) => s.rank === i)}
                  onClick={() =>
                    apply(
                      sel.map((s) => s.e),
                      i,
                    )
                  }
                  title={`Move to ${t.name}${i < 9 ? ` (key ${i + 1})` : ''}`}
                >
                  {i < 9 && <span className="font-num text-muted tabular-nums">{i + 1}</span>}
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
            </span>
            {sel.some((s) => s.e.kind !== 'base') && (
              <span className="flex shrink-0 overflow-hidden rounded-sm border border-line text-xs" role="group" aria-label="Ethereal">
                {([undefined, true, false] as const).map((eth) => {
                  const on = sel.every((s) => s.e.kind === 'base' || s.e.eth === eth);
                  return (
                    <button
                      key={String(eth)}
                      aria-pressed={on}
                      className={`border-line px-2 py-0.5 not-first:border-l ${on ? 'bg-accent/20 text-text' : 'text-muted hover:text-text'}`}
                      onClick={() => setVariant(eth)}
                    >
                      {eth === undefined ? 'Either' : eth ? 'Eth' : 'Non-eth'}
                    </button>
                  );
                })}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-3">
              <button
                className="text-muted hover:text-q-red"
                onClick={() =>
                  apply(
                    sel.map((s) => s.e),
                    null,
                  )
                }
              >
                Remove
              </button>
              <button className="text-muted hover:text-text" onClick={() => setSelected(new Set())} title="Esc">
                Clear
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const Kbd = ({ children }: { children: string }) => <kbd className="rounded-sm border border-line px-1 font-sans text-text">{children}</kbd>;

/** In your grail: a small sigil-gold check. */
const FoundMark = () => (
  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0 text-sigil" aria-label="In your grail" role="img">
    <path d="M1.5 5.2 4 7.6 8.5 2.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function TierRow({
  tier,
  index,
  count,
  color,
  found,
  q,
  collapsed,
  onCollapse,
  selected,
  flash,
  shadowedBy,
  onChange,
  onMove,
  onRemove,
  onDrop,
  onChipClick,
  dragEntries,
  onTake,
  hoverProps,
}: {
  tier: Tier;
  index: number;
  count: number;
  color: string;
  found: Set<string>;
  q: string;
  collapsed: boolean;
  onCollapse: () => void;
  selected: Set<string>;
  flash: string | null;
  shadowedBy: (e: TierEntry) => string | null;
  onChange: (patch: Partial<Tier>, merge?: string) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onDrop: (e: React.DragEvent) => void;
  onChipClick: (id: string, ev: React.MouseEvent) => void;
  dragEntries: (e: TierEntry, id: string) => TierEntry[];
  onTake: (e: TierEntry) => void;
  hoverProps: HoverProps;
}) {
  const [over, setOver] = useState(false);
  // Distinct grail items (eth and non-eth variants of one item count once).
  const grail = [...new Set(tier.entries.filter((e) => e.kind !== 'base').map((e) => `${e.kind === 'unique' ? 'Unique' : 'Set'}:${e.key}`))];
  const have = grail.filter((k) => found.has(k)).length;
  const entries = useMemo(() => [...tier.entries].sort(byOrder), [tier.entries]);
  const matches = q ? entries.filter((e) => hit(plainName(e), q)).length : 0;
  const open = !collapsed || matches > 0;
  return (
    <section
      className={`flex min-h-[64px] rounded-sm border bg-panel ${over ? 'border-accent/70' : 'border-line'} ${q && !matches ? 'opacity-50' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        onDrop(e);
      }}
    >
      <div className="flex w-44 shrink-0 flex-col gap-1 border-r border-line p-2" style={{ borderLeft: `4px solid ${color}` }}>
        <div className="flex items-center gap-1">
          <span className="w-4 text-xs text-muted tabular-nums" title={index < 9 ? `Key ${index + 1}` : undefined}>
            {index < 9 ? index + 1 : ''}
          </span>
          <input
            className="min-w-0 flex-1 rounded-sm bg-transparent px-1 font-num text-base font-bold tracking-wide outline-none focus:bg-panel-hi"
            style={{ color }}
            value={tier.name}
            maxLength={40}
            onChange={(e) => onChange({ name: e.target.value }, `name:${tier.id}`)}
            aria-label="Tier name"
          />
        </div>
        <div className="flex items-center gap-1 text-xs text-muted">
          <label className="relative h-5 w-5 cursor-pointer rounded-sm border border-line focus-within:outline-2 focus-within:outline-accent" style={{ background: color }} title="Colour">
            <input type="color" aria-label="Tier colour" className="absolute inset-0 cursor-pointer opacity-0" value={color} onChange={(e) => onChange({ color: e.target.value }, `color:${tier.id}`)} />
          </label>
          {tier.color && (
            <button className="hover:text-text" title="Back to the ramp colour" onClick={() => onChange({ color: null })}>
              auto
            </button>
          )}
          <span className="ml-auto flex">
            <button className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-panel-hi hover:text-text disabled:opacity-30" disabled={index === 0} onClick={() => onMove(index - 1)} title="Move up" aria-label={`Move ${tier.name} up`}>
              ▲
            </button>
            <button className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-panel-hi hover:text-text disabled:opacity-30" disabled={index === count - 1} onClick={() => onMove(index + 1)} title="Move down" aria-label={`Move ${tier.name} down`}>
              ▼
            </button>
            <button className="flex h-6 w-6 items-center justify-center rounded-sm text-sm hover:bg-panel-hi hover:text-q-red" onClick={onRemove} title="Delete tier (Ctrl+Z brings it back)" aria-label={`Delete the tier ${tier.name}`}>
              ×
            </button>
          </span>
        </div>
        <button
          className="flex items-center gap-1 text-left text-xs text-muted tabular-nums hover:text-text"
          onClick={onCollapse}
          aria-expanded={open}
          title={grail.length > 0 ? `${tier.entries.length} items in this tier; ${have} of its ${grail.length} uniques and sets are in your grail` : undefined}
        >
          <span className="w-3">{open ? '▾' : '▸'}</span>
          {tier.entries.length} items{grail.length > 0 && ` · ${have}/${grail.length} found`}
        </button>
        {q && matches > 0 && <span className="pl-4 text-xs text-accent">{matches === 1 ? '1 match' : `${matches} matches`}</span>}
      </div>
      {open ? (
        <ul className="flex min-w-0 flex-1 flex-wrap content-start gap-1 p-2">
          {entries.length === 0 && <li className="self-center px-1 text-xs text-muted">Drop items here</li>}
          {entries.map((e) => {
            const id = chipId(tier, e);
            const info = ITEMS.get(keyOf(e));
            const eth = ETH_LABEL(e.eth);
            const grailItem = e.kind !== 'base';
            const have = grailItem && found.has(`${e.kind === 'unique' ? 'Unique' : 'Set'}:${e.key}`);
            const dead = shadowedBy(e);
            const match = hit(plainName(e), q);
            const isSel = selected.has(id);
            return (
              <li
                key={id}
                id={id}
                data-match={match || undefined}
                draggable
                onDragStart={(ev) => ev.dataTransfer.setData(DRAG, JSON.stringify({ entries: dragEntries(e, id), chips: true } satisfies Payload))}
                onClick={(ev) => onChipClick(id, ev)}
                onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onChipClick(id, ev as unknown as React.MouseEvent))}
                {...hoverProps(e, id)}
                aria-selected={isSel}
                // Selected: filled. Search match: an accent ring. Just jumped to: a pulsing ring in the tier's colour.
                className={`group flex cursor-pointer items-center gap-1 rounded-sm border py-0.5 pr-1 pl-0.5 text-xs transition-[opacity,box-shadow] select-none ${
                  isSel ? 'border-accent bg-accent/30' : 'border-line bg-bg/40 hover:border-muted/60'
                } ${q && !match ? 'opacity-30' : ''} ${flash === id ? 'animate-pulse ring-2' : match ? 'ring-1 ring-accent' : ''}`}
                style={flash === id ? ({ '--tw-ring-color': color } as React.CSSProperties) : undefined}
                title={dead ? `Never used: ${dead} already catches it` : `${nameOf(e)}${grailItem ? (have ? ' · in your grail' : ' · not found yet') : ''}`}
              >
                {info ? <ItemIcon item={info.item} box={22} /> : <span className="h-[22px] w-[22px] shrink-0 rounded-sm border border-dashed border-line" aria-hidden />}
                <span className={`max-w-[16rem] truncate ${dead ? 'text-faint line-through' : 'text-text'}`}>{info?.name ?? e.key}</span>
                {have && <FoundMark />}
                {eth && <span className="rounded-sm bg-line px-1 text-xs text-text">{eth}</span>}
                <button
                  className="px-0.5 text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-q-red"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onTake(e);
                  }}
                  title="Remove"
                  aria-label={`Remove ${nameOf(e)}`}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <button className="flex-1 px-3 text-left text-xs text-muted hover:text-text" onClick={onCollapse}>
          {tier.entries.length ? `${tier.entries.length} items hidden. Drop here to add, click to show.` : 'Drop items here'}
        </button>
      )}
    </section>
  );
}

function Catalog({
  search,
  setSearch,
  locations,
  draft,
  hoverProps,
  onDrop,
  onJump,
  shadowedBy,
}: {
  search: string;
  setSearch: (s: string) => void;
  locations: Locations;
  draft: TierConfig;
  hoverProps: HoverProps;
  onDrop: (e: React.DragEvent) => void;
  onJump: (rank: number, e: TierEntry) => void;
  shadowedBy: (rank: number, e: TierEntry) => string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set(['Uniques']));
  const [picked, setPicked] = useState<Map<string, TierEntry>>(new Map());
  const [over, setOver] = useState(false);
  const q = search.trim().toLowerCase();
  const toggle = (k: string) => setOpen((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));

  // Where the item sits: a tag per variant, "2 eth", that jumps to its chip.
  const tags = (e: TierEntry) =>
    (locations.get(keyOf(e)) ?? []).map((v) => {
      const at = withEth(e, v.eth);
      const dead = shadowedBy(v.rank, at);
      return (
        <button
          key={`${v.rank}:${v.eth}`}
          className={`shrink-0 rounded-sm border border-line px-1 font-num text-xs leading-4 font-semibold tabular-nums hover:bg-panel ${dead ? 'line-through opacity-50' : ''}`}
          style={{ color: tierColor(draft, v.rank) }}
          onClick={(ev) => {
            ev.stopPropagation();
            onJump(v.rank, at);
          }}
          title={`In ${draft.tiers[v.rank].name}${ETH_LABEL(v.eth) ? ` (${ETH_LABEL(v.eth)})` : ''}${dead ? `, never used: ${dead} already catches it` : ''}. Click to show it.`}
        >
          {v.rank + 1}
          {v.eth === true ? ' eth' : v.eth === false ? ' non' : ''}
        </button>
      );
    });
  const drag = (entries: TierEntry[]) => (ev: React.DragEvent) => ev.dataTransfer.setData(DRAG, JSON.stringify({ entries } satisfies Payload));

  const itemRow = (i: CatalogItem) => {
    const k = keyOf(i.entry);
    const isPicked = picked.has(k);
    return (
      <li
        key={k}
        draggable
        onDragStart={drag(isPicked ? [...picked.values()] : [i.entry])}
        onDragEnd={() => isPicked && setPicked(new Map())}
        onClick={(ev) => {
          if (!ev.shiftKey && !ev.ctrlKey && !ev.metaKey) return;
          setPicked((m) => {
            const next = new Map(m);
            if (next.has(k)) next.delete(k);
            else next.set(k, i.entry);
            return next;
          });
        }}
        {...hoverProps(i.entry)}
        className={`flex cursor-grab items-center gap-1.5 rounded-sm py-0.5 pr-1 pl-1 text-xs select-none ${isPicked ? 'bg-accent/20 text-text' : 'text-muted hover:bg-panel-hi hover:text-text'}`}
      >
        <ItemIcon item={i.item} box={20} />
        <span className="min-w-0 flex-1 truncate">{i.name}</span>
        {tags(i.entry)}
      </li>
    );
  };

  return (
    <aside
      className={`flex max-h-[calc(100vh-2rem)] flex-col gap-2 self-start rounded-sm border bg-panel p-2 md:sticky md:top-4 ${over ? 'border-q-red/60' : 'border-line'}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        onDrop(e);
      }}
      title={over ? 'Drop to remove from its tier' : undefined}
    >
      <input
        className="rounded-sm border border-line bg-bg/40 px-2 py-1 text-sm outline-none focus:border-accent/60"
        placeholder="Find an item (in the tiers too)…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
        data-tier-search
      />
      {picked.size > 0 && (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{picked.size} picked - drag one of them</span>
          <button className="hover:text-text" onClick={() => setPicked(new Map())}>
            Clear
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {q && !CATEGORIES.some((c) => c.groups.some((g) => g.items.some((i) => hit(i.name, q)))) && (
          <p className="px-1 py-2 text-sm text-muted">No item named “{search.trim()}”.</p>
        )}
        {CATEGORIES.map((c) => {
          const groups = c.groups
            .map((g) => ({ ...g, items: q ? g.items.filter((i) => hit(i.name, q)) : g.items }))
            .filter((g) => g.items.length);
          if (!groups.length) return null;
          const catOpen = q !== '' || open.has(c.name);
          return (
            <div key={c.name} className="mb-1">
              <button className="flex w-full items-center gap-1 py-1 text-left text-sm text-text" onClick={() => toggle(c.name)}>
                <span className="w-3 text-muted">{catOpen ? '▾' : '▸'}</span>
                {c.name}
              </button>
              {catOpen &&
                groups.map((g, i) => {
                  const gk = `${c.name}/${g.name}`;
                  const gOpen = q !== '' || open.has(gk);
                  const tiered = g.items.filter((i) => locations.has(keyOf(i.entry))).length;
                  // Uniques: Grail's clusters (Armour, Weapons...) above their first group.
                  const cluster = c.name === 'Uniques' && (i === 0 || clusterOf(groups[i - 1].name) !== clusterOf(g.name)) ? clusterOf(g.name) : null;
                  return (
                    <Fragment key={gk}>
                    {cluster && <div className="mt-2 ml-3 font-num text-[13px] font-semibold tracking-[0.04em] text-faint uppercase">{cluster}</div>}
                    <div className="ml-3">
                      <div
                        draggable
                        onDragStart={drag(g.items.map((i) => i.entry))}
                        className="flex cursor-grab items-center gap-1 py-0.5 text-xs text-muted select-none hover:text-text"
                        onClick={() => toggle(gk)}
                        title="Click to open, drag to tier the whole group"
                      >
                        <span className="w-3">{gOpen ? '▾' : '▸'}</span>
                        <span className="min-w-0 flex-1 truncate">{g.name}</span>
                        <span className="tabular-nums">
                          {tiered > 0 && `${tiered}/`}
                          {g.items.length}
                        </span>
                      </div>
                      {gOpen && <ul className="ml-3">{g.items.map(itemRow)}</ul>}
                    </div>
                    </Fragment>
                  );
                })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
