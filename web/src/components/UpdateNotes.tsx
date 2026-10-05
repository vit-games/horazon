import { useEffect, useRef, useState, type ReactNode } from 'react';
import changelog from '../../../CHANGELOG.md?raw';
import { desktop, useUpdateStatus } from '../lib/desktop';
import { btnPrimarySm } from '../lib/ui';

const SEEN_KEY = 'horazon.seenVersion';
const LATER_KEY = 'horazon.updateLater';
export const APP_VERSION = desktop?.version ?? __APP_VERSION__;

/** A version's section of CHANGELOG.md (bundled at build time): its "#### HEADING" groups and their lines. */
function notesFor(version: string): { heading: string | null; items: string[] }[] | null {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## v${version}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const groups: { heading: string | null; items: string[] }[] = [];
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    if (line.startsWith('#### ')) groups.push({ heading: line.slice(5).trim(), items: [] });
    else if (line.startsWith('- ')) (groups.at(-1) ?? groups[groups.push({ heading: null, items: [] }) - 1]).items.push(line.slice(2).trim());
    else if (line.trim() && groups.at(-1)?.items.length) {
      const items = groups.at(-1)!.items;
      items[items.length - 1] += ` ${line.trim()}`; // a bullet's wrapped line
    } else if (line.trim()) (groups.at(-1) ?? groups[groups.push({ heading: null, items: [] }) - 1]).items.push(line.trim());
  }
  return groups.length ? groups : null;
}

/** **bold**, *italic* and `code`, the little markdown the changelog uses. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/).map((part, i) =>
    part.startsWith('**') ? (
      <b key={i} className="font-semibold text-text">
        {part.slice(2, -2)}
      </b>
    ) : part.startsWith('`') ? (
      <code key={i} className="font-num text-text">
        {part.slice(1, -1)}
      </code>
    ) : part.startsWith('*') && part.length > 2 ? (
      <i key={i}>{part.slice(1, -1)}</i>
    ) : (
      part
    ),
  );
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: shown again next start
  }
};

/**
 * The status strip's update corner: an update downloading or ready to install (restart now or
 * later), and "What's new", which opens on its own the first time a version runs and stays one
 * click away after. Not modal, like the symbol key: Esc or a click outside closes it.
 */
export function UpdateNotes() {
  const status = useUpdateStatus();
  const notes = notesFor(APP_VERSION);
  const [open, setOpen] = useState(() => !!notes && read(SEEN_KEY) !== APP_VERSION);
  const [later, setLater] = useState(() => read(LATER_KEY));
  const [installing, setInstalling] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    write(SEEN_KEY, APP_VERSION);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && close();
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = status?.state === 'ready' && later !== status.version ? status : null;
  return (
    <div ref={box} className="relative flex items-center gap-3">
      {status?.state === 'downloading' && (
        <span className="text-muted tabular-nums" title={`Version ${status.version}`}>
          Update downloading {Math.round(status.percent)}%
        </span>
      )}
      {ready && (
        <span className="flex items-center gap-2" role="status">
          <span className="text-accent">Version {ready.version} is ready</span>
          <button
            className={btnPrimarySm}
            disabled={installing}
            title="Your data stays as it is, and a backup is taken first"
            onClick={() => {
              setInstalling(true);
              desktop?.installUpdate();
            }}
          >
            {installing ? 'Restarting…' : 'Restart and update'}
          </button>
          <button
            className="text-[13px] text-muted hover:text-text"
            title="It installs when you quit Horazon"
            onClick={() => {
              setLater(ready.version);
              write(LATER_KEY, ready.version);
            }}
          >
            Later
          </button>
        </span>
      )}
      {notes && (
        <button
          className={`text-[13px] ${open ? 'text-accent' : 'text-muted hover:text-text'}`}
          aria-expanded={open}
          aria-controls="whats-new"
          onClick={() => (open ? close() : setOpen(true))}
          title={`What's new in ${APP_VERSION}`}
        >
          What's new
        </button>
      )}
      {open && notes && (
        <div
          id="whats-new"
          role="region"
          aria-label={`What's new in ${APP_VERSION}`}
          className="absolute top-full right-0 z-30 mt-2 max-h-[min(78vh,640px)] w-[min(560px,calc(100vw-2rem))] overflow-y-auto rounded-sm border border-line bg-panel p-5 text-sm shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)]"
        >
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-lg text-text">What's new</h2>
            <span className="font-num text-sm font-semibold text-muted">v{APP_VERSION}</span>
          </div>
          <div className="flex flex-col gap-4">
            {notes.map((g, i) => (
              <section key={i} className="flex flex-col gap-1.5">
                {g.heading && <h3 className="border-b border-line pb-1 font-sans text-xs font-semibold tracking-[0.04em] text-muted uppercase">{g.heading}</h3>}
                <ul className="flex flex-col gap-1.5 leading-snug text-muted">
                  {g.items.map((item, k) => (
                    <li key={k}>{inline(item)}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button className={btnPrimarySm} onClick={close}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
