import { useEffect, useMemo, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { addManualSale, fetchHoldings } from '../lib/api';
import { CURRENCY_BY_CODE, CURRENCY_CATALOG, currencyItem } from '../lib/currencyCatalog';
import { fieldSm as input, btnSm as button } from '../lib/ui';


/**
 * Record a sale outside item listings: click the currencies sold to highlight them (those you
 * hold right now come first) and/or describe it (a carry, a boss kill), then what you received.
 */
export function ManualSaleForm({ onDone }: { onDone: () => void }) {
  const [holdings, setHoldings] = useState<Record<string, number>>({});
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Map<string, string>>(new Map()); // code -> qty draft
  const [hr, setHr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHoldings().then(setHoldings, () => {});
  }, []);

  const owned = (code: string) => holdings[code] ?? 0;
  const choices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = CURRENCY_CATALOG.filter((c) => (q ? c.name.toLowerCase().includes(q) : showAll || owned(c.code) > 0 || picked.has(c.code)));
    return list; // catalog order: high runes first, then uber mats, keys, ...
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, showAll, holdings, picked]);

  const items = [...picked].map(([code, draft]) => ({ code, qty: Number(draft) }));
  const itemsValid = items.length > 0 && items.every((i) => Number.isInteger(i.qty) && i.qty > 0);
  const value = Number(hr.replace(',', '.'));
  const described = note.trim() !== '';
  const valid = (picked.size ? itemsValid : described) && hr.trim() !== '' && Number.isFinite(value) && value >= 0;

  const toggle = (code: string) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(code)) next.delete(code);
      else next.set(code, '1');
      return next;
    });

  return (
    <form
      className="flex flex-col gap-3 rounded-sm border border-line bg-panel p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        setError(null);
        addManualSale(items, value, note).then(onDone, (err: Error) => {
          setError(err.message);
          setBusy(false);
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-text">Manual sale</span>
        <span className="text-xs text-muted">Currency and/or a service</span>
        <input className={`${input} w-48`} placeholder="Search currency…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" className="accent-accent" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all (not only what you hold)
        </label>
      </div>

      <div className="flex max-h-52 flex-wrap content-start gap-1.5 overflow-y-auto">
        {choices.length === 0 && <p className="text-xs text-muted">No currency held right now. Search, or tick “Show all”.</p>}
        {choices.map((c) => {
          const on = picked.has(c.code);
          return (
            <button
              type="button"
              key={c.code}
              onClick={() => toggle(c.code)}
              aria-pressed={on}
              className={`flex items-center gap-1 rounded-sm border py-0.5 pr-2 pl-1 text-xs ${on ? 'border-accent bg-accent/15 text-text' : 'border-line text-muted hover:text-text'}`}
            >
              <ItemIcon item={currencyItem(c.code)} box={22} />
              {c.name}
              {owned(c.code) > 0 && <span className="text-faint tabular-nums">×{owned(c.code)}</span>}
            </button>
          );
        })}
      </div>

      {picked.size > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {[...picked].map(([code, draft]) => (
            <label key={code} className="flex items-center gap-1.5 rounded-sm border border-line bg-panel-hi py-0.5 pr-1 pl-1 text-xs text-text">
              <ItemIcon item={currencyItem(code)} box={22} />
              {CURRENCY_BY_CODE.get(code)?.name}
              <span className="text-muted">×</span>
              <input
                className={`${input} w-12 py-0 text-center`}
                inputMode="numeric"
                value={draft}
                onChange={(e) => setPicked((prev) => new Map(prev).set(code, e.target.value))}
              />
              <button type="button" className="px-1 text-muted hover:text-text" aria-label="Remove" onClick={() => toggle(code)}>
                ×
              </button>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5 text-muted">
          Received
          <input className={`${input} w-24 text-text`} inputMode="decimal" placeholder="1.5" value={hr} onChange={(e) => setHr(e.target.value)} />
          HR
        </label>
        <input className={`${input} min-w-0 flex-1`} placeholder={picked.size ? 'Note (optional), e.g. paid in Ber + Ist' : 'What you sold, e.g. Uber Tristram carry'} value={note} onChange={(e) => setNote(e.target.value)} />
        <button className={button} disabled={!valid || busy}>
          {busy ? 'Saving…' : 'Save sale'}
        </button>
        <button type="button" className={button} onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-q-red">{error}</p>}
    </form>
  );
}
