import { useState } from 'react';
import { postListing } from '../lib/api';
import { fieldSm as input, btnSm as button } from '../lib/ui';


/** Post a drop on the PD2 trade site: our own HR price plus the free-text note buyers see. */
export function SellForm({ dropId, onDone }: { dropId: number; onDone: () => void }) {
  const [hr, setHr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(hr.replace(',', '.'));
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
      <input className={`${input} min-w-0 flex-1`} placeholder="Note for buyers, e.g. Ist + c/o" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className={button} disabled={!valid || busy}>
        {busy ? 'Posting…' : 'Post on trade site'}
      </button>
      <button type="button" className={button} onClick={onDone}>
        Cancel
      </button>
      {error && <div className="w-full text-xs text-q-red">{error}</div>}
    </form>
  );
}
