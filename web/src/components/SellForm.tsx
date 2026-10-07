import { useState } from 'react';
import { postListing } from '../lib/api';
import { listingNote } from '../lib/modShort';
import type { Item } from '../lib/types';
import { fieldSm as input, btnSm as button } from '../lib/ui';

const PRESETS = ['0.05', '0.1', '0.25', '0.5', '1', '2'];

/** Post a drop on the PD2 trade site: our own HR price plus the free-text note buyers see. */
export function SellForm({ dropId, item, onDone }: { dropId: number; item: Item; onDone: () => void }) {
  const [hr, setHr] = useState('');
  // The note writes itself from the price and the item's stats until you type in it.
  const [edited, setEdited] = useState<string | null>(null);
  const note = edited ?? listingNote(item, hr);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // No comma decimals here: a slip between , and . would post the item far too cheap.
  const value = Number(hr);
  const valid = hr.trim() !== '' && Number.isFinite(value) && value >= 0;

  return (
    <form
      className="flex flex-wrap items-center gap-2 border-b border-line/50 bg-panel-hi/50 py-2 pr-3 pl-[68px] text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        setError(null);
        postListing(dropId, value, note).then(onDone, (err: Error) => {
          setError(err.message);
          setBusy(false);
        });
      }}
    >
      <label className="flex items-center gap-1.5 text-muted">
        Price
        <input className={`${input} w-24 text-text`} inputMode="decimal" autoFocus placeholder="0.5" value={hr} onChange={(e) => setHr(e.target.value)} />
        HR
      </label>
      <span className="flex gap-1">
        {PRESETS.map((p) => (
          <button key={p} type="button" className={`${button} font-num tabular-nums ${hr === p ? 'border-accent/60' : ''}`} onClick={() => setHr(p)}>
            {p}
          </button>
        ))}
      </span>
      <input className={`${input} min-w-80 flex-1`} placeholder="Note for buyers, e.g. Ist + c/o" value={note} onChange={(e) => setEdited(e.target.value)} />
      <button className={button} disabled={!valid || busy}>
        {busy ? 'Posting…' : 'Post on trade site'}
      </button>
      <button type="button" className={button} onClick={onDone}>
        Cancel
      </button>
      {hr.includes(',') && <div className="w-full text-xs text-q-red">Use a dot for decimals, e.g. 0.5</div>}
      {error && <div className="w-full text-xs text-q-red">{error}</div>}
    </form>
  );
}
