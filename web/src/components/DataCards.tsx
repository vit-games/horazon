import { useEffect, useRef, useState } from 'react';
import {
  backupUrl,
  compactDatabase,
  createBackup,
  deleteBackup,
  deleteCharacterData,
  fetchCharacterData,
  fetchDatabase,
  importBackup,
  restoreBackup,
  type BackupInfo,
  type CharacterData,
  type DatabaseInfo,
} from '../lib/api';
import { useChanges } from '../lib/live';
import { Card } from './Card';
import { field as input, btn as button, linkSm as small, linkDanger as smallDanger } from '../lib/ui';


const timeFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const KIND_LABEL: Record<BackupInfo['kind'], string> = {
  manual: 'Manual',
  auto: 'Daily',
  safety: 'Before change',
  update: 'Before update',
  imported: 'Imported',
};

interface Props {
  onMessage: (message: string) => void;
}

/** Back up, import, download and restore the database; database size and compaction. */
export function BackupsCard({ onMessage, autoBackupKeep, onAutoBackupKeep }: Props & { autoBackupKeep: number; onAutoBackupKeep: (n: number) => void }) {
  const [db, setDb] = useState<DatabaseInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const version = useChanges('drops', 'stats', 'runs');
  // The newest few, the rest on request: no scroll area inside the page's own.
  const [allBackups, setAllBackups] = useState(false);
  const BACKUPS_SHOWN = 5;

  const load = () => fetchDatabase().then(setDb, (e: Error) => onMessage(e.message));
  useEffect(() => {
    void load();
  }, [version]);

  async function run(label: string, action: () => Promise<string>) {
    setBusy(label);
    try {
      onMessage(await action());
    } catch (e) {
      onMessage(`${label} failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      await load();
    }
  }

  const restore = (b: BackupInfo) => {
    const when = timeFmt.format(new Date(b.createdAt));
    if (!confirm(`Replace all current data with the backup from ${when}?\n\nThe current data is backed up first, so this can be undone.`)) return;
    void run('Restore', async () => {
      const r = await restoreBackup(b.name);
      return `Restored the backup from ${when}. The previous data was saved as "${r.safety}".`;
    });
  };

  return (
    <Card
      title="Backups"
      footer={
        <>
          A backup is the whole database in one file (including the saved PD2 token), restorable here or in another Horazon
          install. Restoring or removing a character first saves the current data as a "Before change" backup
          and a new Horazon version that changes the database a "Before update" one (the last 5 of each are kept). Files are kept in <code>{db?.backupDir ?? '…'}</code>.
        </>
      }
    >
      {db && (
        <p className="text-muted">
          Database: <span className="text-text">{formatBytes(db.bytes)}</span>,{' '}
          {db.tables.reduce((n, t) => n + t.rows, 0).toLocaleString()} rows
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} disabled={!!busy} onClick={() => run('Backup', async () => `Backup saved: ${(await createBackup()).name}`)}>
          {busy === 'Backup' ? 'Backing up…' : 'Back up now'}
        </button>
        <button className={button} disabled={!!busy} onClick={() => fileInput.current?.click()}>
          Import backup…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".gz,application/gzip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void run('Import', async () => `Imported "${file.name}" as ${(await importBackup(file)).name}. Restore it from the list below.`);
          }}
        />
        <button
          className={button}
          disabled={!!busy}
          title="Reclaim space left by deleted and updated rows"
          onClick={() =>
            run('Compact', async () => {
              const r = await compactDatabase();
              return `Database compacted: ${formatBytes(r.before)} → ${formatBytes(r.after)}`;
            })
          }
        >
          {busy === 'Compact' ? 'Compacting…' : 'Compact database'}
        </button>
      </div>
      <label className="flex items-center gap-2 text-muted">
        Keep
        <input
          type="number"
          min={0}
          max={90}
          className={`${input} w-20`}
          defaultValue={autoBackupKeep}
          onBlur={(e) => Number(e.target.value) !== autoBackupKeep && onAutoBackupKeep(Number(e.target.value))}
        />
        daily backups (0 = off)
      </label>

      <div>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line text-left">
              <th className="py-1.5 pr-3 font-normal">Date</th>
              <th className="py-1.5 pr-3 font-normal">Kind</th>
              <th className="py-1.5 pr-3 text-right font-normal">Size</th>
              <th className="py-1.5 font-normal" />
            </tr>
          </thead>
          <tbody>
            {db?.backups.length ? (
              (allBackups ? db.backups : db.backups.slice(0, BACKUPS_SHOWN)).map((b) => (
                <tr key={b.name} className="group border-b border-line/60 last:border-0" title={b.name}>
                  <td className="py-1.5 pr-3 tabular-nums">{timeFmt.format(new Date(b.createdAt))}</td>
                  <td className="py-1.5 pr-3 text-muted">{KIND_LABEL[b.kind]}</td>
                  <td className="py-1.5 pr-3 text-right text-muted tabular-nums">{formatBytes(b.size)}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <span className="inline-flex gap-3">
                      <button className={small} disabled={!!busy} onClick={() => restore(b)}>
                        Restore
                      </button>
                      {/* Restore is the row's action; download and delete show on hover or focus. */}
                      <a className={`${small} opacity-0 group-focus-within:opacity-100 group-hover:opacity-100`} href={backupUrl(b.name)} download={b.name}>
                        Download
                      </a>
                      <button
                        className={`${smallDanger} opacity-0 group-focus-within:opacity-100 group-hover:opacity-100`}
                        disabled={!!busy}
                        onClick={() => confirm(`Delete the backup ${b.name}?`) && void run('Delete', async () => (await deleteBackup(b.name), 'Backup deleted'))}
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-2 text-muted">
                  No backups yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {db && db.backups.length > BACKUPS_SHOWN && (
          <button className={`${small} mt-1.5`} onClick={() => setAllBackups((v) => !v)}>
            {allBackups ? 'Show the newest only' : `Show all ${db.backups.length} backups`}
          </button>
        )}
      </div>

      {db && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer hover:text-text">Tables</summary>
          <table className="mt-2 w-full">
            <tbody>
              {db.tables.map((t) => (
                <tr key={t.name}>
                  <td className="py-0.5 pr-3">{t.name}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{t.rows.toLocaleString()} rows</td>
                  <td className="py-0.5 text-right tabular-nums">{formatBytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Card>
  );
}

/** Per-character data with a way to remove everything recorded for one character. */
export function CharacterDataCard({ onMessage }: Props) {
  const [chars, setChars] = useState<CharacterData[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [untrack, setUntrack] = useState(true);
  const [busy, setBusy] = useState(false);
  const version = useChanges('drops', 'stats', 'runs', 'sources');

  const load = () => fetchCharacterData().then(setChars, (e: Error) => onMessage(e.message));
  useEffect(() => {
    void load();
  }, [version]);

  async function remove(name: string) {
    setBusy(true);
    try {
      const r = await deleteCharacterData(name, untrack);
      onMessage(
        `Removed ${name}: ${r.removed.drops} drops, ${r.removed.stats} stat readings, ${r.removed.games} games. The previous data was saved as "${r.safety}".`,
      );
      setRemoving(null);
    } catch (e) {
      onMessage(`Removing ${name} failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <Card
      title="Character data"
      footer="Removing a character deletes its drops, stat readings and captured games (with their map runs). Listings and sales stay, unlinked from the removed drops. A still-checked character starts over with a new baseline."
    >
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line text-left">
            <th className="py-1.5 pr-3 font-normal">Character</th>
            <th className="py-1.5 pr-3 text-right font-normal">Drops</th>
            <th className="py-1.5 pr-3 text-right font-normal">Stat readings</th>
            <th className="py-1.5 pr-3 text-right font-normal">Games</th>
            <th className="py-1.5 font-normal" />
          </tr>
        </thead>
        <tbody>
          {chars?.length === 0 && (
            <tr>
              <td colSpan={5} className="py-2 text-muted">
                No character data.
              </td>
            </tr>
          )}
          {chars?.map((c) => (
            <tr key={c.character} className="border-b border-line/60 last:border-0">
              <td className="py-1.5 pr-3">
                {c.character}
                {c.polled && <span className="ml-2 text-xs text-muted">checked</span>}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{c.drops.toLocaleString()}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{c.stats.toLocaleString()}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{c.games.toLocaleString()}</td>
              <td className="py-1.5 text-right">
                {removing === c.character ? (
                  <span className="inline-flex items-center gap-3">
                    {c.tracked && (
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input type="checkbox" className="accent-accent" checked={untrack} onChange={(e) => setUntrack(e.target.checked)} />
                        stop checking
                      </label>
                    )}
                    <button className="text-xs text-q-red hover:underline disabled:opacity-50" disabled={busy} onClick={() => void remove(c.character)}>
                      {busy ? 'Removing…' : 'Remove all'}
                    </button>
                    <button className={small} disabled={busy} onClick={() => setRemoving(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button className={small} onClick={() => setRemoving(c.character)}>
                    Remove…
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
