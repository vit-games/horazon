import { useEffect, useState } from 'react';
import {
  deleteSampleData,
  fetchSettings,
  fetchSources,
  pollNow,
  saveSettings,
  seedSampleSeason,
  type SettingsView as Settings,
  type SourceStatus,
} from '../lib/api';
import { Card } from '../components/Card';
import { ConnectionCard } from '../components/ConnectionCard';
import { BackupsCard, CharacterDataCard } from '../components/DataCards';
import { fetchCaptureGames } from '../lib/capture';
import { useChanges } from '../lib/live';
import { field as input, btn as button, btnDanger as danger, subnav } from '../lib/ui';

const timeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmt = (t: string | null) => (t ? timeFmt.format(new Date(t)) : '—');
/** `character:Vitsin` -> "Vitsin's gear", `stash:acct` -> "Shared stash (acct)". */
const sourceName = (key: string) => {
  const [kind, name] = key.split(':');
  return kind === 'character' ? `${name}'s gear` : kind === 'stash' ? `Shared stash${name && name !== 'pending' ? ` (${name})` : ''}` : key;
};

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sources, setSources] = useState<{ sources: SourceStatus[]; lastCycle: string | null; running: boolean } | null>(null);
  const [account, setAccount] = useState('');
  const [token, setToken] = useState('');
  const [newChar, setNewChar] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const version = useChanges('sources');
  // Characters seen in captured games: the ones not listed get a line, so Runs showing them isn't a surprise.
  const [played, setPlayed] = useState<string[]>([]);
  useEffect(() => {
    fetchCaptureGames().then((g) => setPlayed([...new Set(g.flatMap((x) => (x.character ? [x.character] : [])))]), () => {});
  }, []);
  // `#setup/data` is Your data; anything else Sources. The status strip's fix links open Sources at
  // their card: `#setup/connection` (capture), `#setup/stash` (the token), `#setup/checks` (a failing source).
  const [page, setPage] = useState(() => (location.hash === '#setup/data' ? 'data' : 'sources'));
  useEffect(() => {
    const go = () => {
      setPage(location.hash === '#setup/data' ? 'data' : 'sources');
      const card = { '#setup/connection': 'connection', '#setup/stash': 'stash', '#setup/checks': 'checks' }[location.hash];
      if (card) document.getElementById(card)?.scrollIntoView();
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [settings !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = () =>
    Promise.all([fetchSettings(), fetchSources()]).then(([s, src]) => {
      setSettings(s);
      setSources(src);
      setAccount((a) => a || s.account || '');
    });

  useEffect(() => {
    void load();
  }, [version]);

  async function save(patch: Parameters<typeof saveSettings>[0], note: string) {
    setBusy(true);
    try {
      await saveSettings(patch);
      setMessage(note);
      await load();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }


  if (!settings) return <div className="h-64 animate-pulse rounded-sm border border-line bg-panel/60" aria-busy="true" />;
  const chars = Object.entries(settings.characters).sort(([a], [b]) => a.localeCompare(b));
  // pd2-token is a JWT (the server strips quotes and "Bearer" too); anything else was copied wrong.
  const bare = token.trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '');
  const tokenLooksWrong = bare !== '' && !/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(bare);

  return (
    <>
    <nav className={subnav} aria-label="Setup">
      {(
        [
          ['sources', 'Sources', '#setup'],
          ['data', 'Your data', '#setup/data'],
        ] as const
      ).map(([key, label, href]) => (
        <a
          key={key}
          href={href}
          aria-current={page === key ? 'page' : undefined}
          className={`-mb-px border-b-2 px-3 py-1.5 ${page === key ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}
        >
          {label}
        </a>
      ))}
    </nav>
    {message && (
      <div className="rounded-sm border border-line bg-panel-hi px-3 py-2 text-sm text-text" role="status">
        {message}
      </div>
    )}

    {page === 'sources' && (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* First: the game itself, where every run comes from. The status strip's capture link lands here. */}
      <div id="connection" className="scroll-mt-4 lg:col-span-2">
        <ConnectionCard />
      </div>

      <div id="checks" className="scroll-mt-4">
      <Card
        title="Item checks"
        footer="New items become drops; a rune or gem count that rises and holds for 10 minutes does too. Each source's first check is a baseline, not drops."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line text-left">
                <th className="py-1.5 pr-3 font-normal">Source</th>
                <th className="py-1.5 pr-3 font-normal">Game save</th>
                <th className="py-1.5 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {sources?.sources.length ? (
                sources.sources.map((s) => (
                  <tr key={s.key} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 pr-3">{sourceName(s.key)}</td>
                    <td className="py-1.5 pr-3 text-muted tabular-nums">{fmt(s.game_saved_at)}</td>
                    <td className={`py-1.5 ${s.last_error ? 'text-q-red' : 'text-muted'}`}>{s.last_error ?? `OK · ${fmt(s.last_poll_at)}`}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-2 text-muted">
                    {chars.length === 0
                      ? 'Nothing to check yet. Add a character under Characters, or save a stash token.'
                      : chars.some(([, on]) => on)
                        ? 'Not checked yet. Check now, or wait for the next cycle.'
                        : `Nothing is checked: ${chars.map(([n]) => n).join(', ')} ${chars.length === 1 ? 'is' : 'are'} paused. Tick ${chars.length === 1 ? 'it' : 'one'} under Characters${settings.hasToken ? '' : ', or save a stash token'}.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={button} disabled={busy || sources?.running} onClick={() => pollNow().then(load)}>
            Check now
          </button>
          <label className="flex items-center gap-2 text-muted">
            every
            <select
              className={input}
              value={settings.pollSeconds}
              onChange={(e) => save({ pollSeconds: Number(e.target.value) }, 'Check interval saved')}
            >
              {[...new Set([30, 60, 120, 300, 600, settings.pollSeconds])]
                .sort((a, b) => a - b)
                .map((s) => (
                  <option key={s} value={s} className="bg-panel">
                    {s < 60 ? `${s} seconds` : s === 60 ? '1 minute' : s % 60 ? `${(s / 60).toFixed(1)} minutes` : `${s / 60} minutes`}
                  </option>
                ))}
            </select>
          </label>
          <span className="text-xs text-muted">Last cycle {fmt(sources?.lastCycle ?? null)}</span>
        </div>
      </Card>
      </div>

      <Card title="Characters" footer="Ticked characters get their gear, charms and mercenary gear checked on the public PD2 armory (no login); unticking pauses that, and their runs and kills are still recorded. Other inventory loot shows once stashed or equipped. Characters of captured games are added automatically.">
        {chars.length === 0 && <p className="text-muted">No characters yet.</p>}
        {played.some((n) => !(n in settings.characters)) && (
          <p className="text-sm text-muted">
            Also played, not checked here:{' '}
            {played
              .filter((n) => !(n in settings.characters))
              .map((n, i) => (
                <span key={n}>
                  {i > 0 && ', '}
                  <button className="text-accent hover:underline" disabled={busy} onClick={() => save({ characters: { ...settings.characters, [n]: true } }, `Added ${n}`)}>
                    {n}
                  </button>
                </span>
              ))}
            . Their runs and kills are recorded anyway; add one to check its gear too.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {chars.map(([name, on]) => (
            <li key={name} className="flex items-center gap-2">
              <input
                id={`char-${name}`}
                type="checkbox"
                checked={on}
                className="accent-accent"
                onChange={() => save({ characters: { ...settings.characters, [name]: !on } }, `${name} ${on ? 'paused' : 'enabled'}`)}
              />
              <label htmlFor={`char-${name}`}>
                {name}
                {!on && <span className="ml-2 text-xs text-muted">paused</span>}
              </label>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newChar.trim();
            if (!name) return;
            setNewChar('');
            void save({ characters: { ...settings.characters, [name]: true } }, `Added ${name}`);
          }}
        >
          <input className={`${input} min-w-0 flex-1`} placeholder="Character name" aria-label="Character name to add" value={newChar} onChange={(e) => setNewChar(e.target.value)} />
          <button className={button} disabled={busy}>
            Add
          </button>
        </form>
      </Card>

      <div id="stash" className="scroll-mt-4">
      <Card
        title="Stash"
        footer={
          <>
            Without a token, items stashed right after pickup are never seen and stashed uniques and sets are missing from the grail. It is stored only
            in your local database.
          </>
        }
      >
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted marker:font-num marker:text-text">
          <li>Log in on projectdiablo2.com in your browser.</li>
          <li>
            Press <kbd className="font-num text-text">F12</kbd>, open <span className="text-text">Console</span> and run{' '}
            <code className="text-text">localStorage.getItem('pd2-token')</code>.
          </li>
          <li>Paste the value below and save. When it expires, the status bar says so; paste a new one the same way.</li>
        </ol>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Account name (optional - detected from the token)</span>
          <input className={input} value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Detected automatically" />
        </label>
        <label className="flex flex-col gap-1">
          {/* The label, then its state: "Token · saved (…)" or "Token · none saved yet". */}
          <span className="text-xs text-muted">
            Token <span aria-hidden>·</span>{' '}
            {settings.hasToken ? (
              <span className={settings.tokenExpires && new Date(settings.tokenExpires) < new Date() ? 'text-q-red' : 'text-text'}>
                saved ({settings.tokenHint}
                {settings.tokenExpires && `, ${new Date(settings.tokenExpires) < new Date() ? 'expired' : 'expires'} ${fmt(settings.tokenExpires)}`})
              </span>
            ) : (
              <span className="text-warn">none saved yet</span>
            )}
          </span>
          <input
            className={input}
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={settings.hasToken ? 'Paste a new token to replace it' : 'eyJ… (value of pd2-token)'}
            aria-invalid={tokenLooksWrong || undefined}
            aria-describedby={tokenLooksWrong ? 'token-hint' : undefined}
          />
          {tokenLooksWrong && (
            <span id="token-hint" className="text-xs text-warn">
              This doesn't look like the token: it starts with eyJ and has two dots. Copy the whole value the console printed.
            </span>
          )}
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            disabled={busy || (!token && account === (settings.account ?? ''))}
            onClick={() => {
              void save({ account, ...(token ? { token } : {}) }, 'Shared stash settings saved; checking now');
              setToken('');
            }}
          >
            Save
          </button>
          {settings.hasToken && (
            <button className={danger} disabled={busy} onClick={() => save({ token: '' }, 'Token removed')}>
              Remove token
            </button>
          )}
        </div>
      </Card>
      </div>

    </div>
    )}

    {page === 'data' && (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <BackupsCard
        onMessage={setMessage}
        autoBackupKeep={settings.autoBackupKeep}
        onAutoBackupKeep={(n) => save({ autoBackupKeep: n }, n ? `Keeping ${n} daily backups` : 'Daily backups off')}
      />
      <CharacterDataCard onMessage={setMessage} />

      <Card
        title="Sample data"
        footer="The sample season is two months of play for Blizzy at the start of the last finished season: drops, stat readings and trades. Delete removes all demo drops, trades and stat history (characters Blizzy and Hammerbro). Your real data is untouched."
      >
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            disabled={busy}
            onClick={async () => {
              const r = await seedSampleSeason().catch((e: Error) => ({ skipped: e.message }));
              setMessage('skipped' in r ? String(r.skipped) : `Sample season added to ${r.season}: ${r.drops} drops, ${r.listings} listings, ${r.manual} manual sales`);
            }}
          >
            Generate sample season
          </button>
          <button
            className={danger}
            disabled={busy}
            onClick={async () => {
              if (!confirm('Delete all sample drops, trades and stat readings?')) return;
              await deleteSampleData();
              setMessage('Sample data deleted');
            }}
          >
            Delete sample data
          </button>
        </div>
      </Card>
    </div>
    )}
    </>
  );
}
