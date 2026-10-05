import { useEffect, useState, type ReactNode } from 'react';
import { Card } from './Card';
import { Portal } from './Portal';
import { fetchCaptureStatus, type CaptureStatus } from '../lib/capture';
import { desktop, useConnection } from '../lib/desktop';
import { useChanges } from '../lib/live';
import { btnSm } from '../lib/ui';

const timeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const when = (t: string | null) => (t ? timeFmt.format(new Date(t)) : null);
/** Capture running and the game open, yet nothing heard for this long: worth a word. */
const QUIET_MS = 5 * 60e3;

/** One source: its name, its state in a word, then what it means and what to do. */
function Row({ name, state, tone = 'ok', children, action }: { name: string; state: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'idle'; children?: ReactNode; action?: ReactNode }) {
  const color = { ok: 'text-text', warn: 'text-warn', bad: 'text-q-red', idle: 'text-muted' }[tone];
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1.5 border-b border-line/60 pb-3 last:border-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-muted">{name}</span>
          <span className={`font-semibold ${color}`}>{state}</span>
        </span>
        {children && <span className="pl-26 text-xs text-muted">{children}</span>}
      </div>
      {action}
    </div>
  );
}

/**
 * Setup's first card: the game connection. Network capture records games, map runs,
 * kills, deaths and playtime. It says its state and, when wrong, the fix.
 * Capture is run by the desktop app; in a plain browser only what the server saw is known.
 */
export function ConnectionCard() {
  const connection = useConnection();
  const [server, setServer] = useState<CaptureStatus | null>(null);
  const version = useChanges('live', 'runs');
  useEffect(() => {
    fetchCaptureStatus().then(setServer, () => {});
  }, [version]);

  const c = connection?.capture;
  const lastEvent = server?.lastEventAt ?? null;
  const quiet = c?.state === 'running' && connection?.game && (!lastEvent || Date.now() - new Date(lastEvent).getTime() > QUIET_MS);
  const btn = (label: string, onClick?: () => void) =>
    onClick && (
      <button className={btnSm} onClick={onClick}>
        {label}
      </button>
    );

  const capture = !connection ? (
    <Row name="Capture" state={lastEvent ? 'Traffic seen' : 'Nothing yet'} tone={lastEvent ? 'ok' : 'idle'}>
      {lastEvent ? `Last game traffic ${when(lastEvent)}. ` : ''}Capture runs from the Horazon desktop app; its tray menu shows and controls it.
    </Row>
  ) : c?.state === 'error' ? (
    <Row name="Capture" state="Stopped" tone="bad" action={btn('Start capture', desktop?.setCapture && (() => desktop!.setCapture!(true)))}>
      {c.message}. Start it again; if it keeps stopping, restart Horazon.
    </Row>
  ) : c?.state === 'no-permission' ? (
    <Row name="Capture" state="Needs permission" tone="bad" action={btn('Grant permission', desktop?.grantCapture)}>
      Reading the game's network traffic needs a one-time permission{connection.platform === 'linux' ? ' (your password, once)' : ''}.
    </Row>
  ) : c?.state === 'running' ? (
    <Row name="Capture" state={quiet ? 'Recording, nothing heard' : 'Recording'} tone={quiet ? 'warn' : 'ok'} action={btn('Stop', desktop?.setCapture && (() => desktop!.setCapture!(false)))}>
      {quiet
        ? `The game is open but no game traffic has arrived${lastEvent ? ` since ${when(lastEvent)}` : ''}. Join a game; if this stays, stop and start capture.`
        : lastEvent
          ? `Last game traffic ${when(lastEvent)}.`
          : 'Waiting for the first game.'}
    </Row>
  ) : (
    <Row
      name="Capture"
      state={c?.state === 'stopping' ? 'Stopping…' : 'Off'}
      tone={connection.game ? 'bad' : 'idle'}
      action={c?.state === 'off' && btn('Start capture', desktop?.setCapture && (() => desktop!.setCapture!(true)))}
    >
      {connection.game
        ? 'The game is running but nothing is being recorded. Start capture.'
        : connection.autoCapture
          ? 'Starts on its own when the game starts.'
          : 'Starting with the game is turned off in the tray menu; start it here or there.'}
      {lastEvent && ` Last game traffic ${when(lastEvent)}.`}
    </Row>
  );

  return (
    <Card
      title="Game connection"
      footer="Capture reads the game's network traffic on this computer to record games, map runs and kills; nothing is sent anywhere."
    >
      <span className="flex items-center gap-2 text-xs text-muted">
        <Portal state={c?.state === 'error' || c?.state === 'no-permission' ? 'error' : c?.state === 'running' && !quiet ? 'live' : 'idle'} size={16} />
        {connection ? (connection.game ? 'Project Diablo 2 is running' : 'Project Diablo 2 is not running') : 'Open in a browser: the desktop app owns capture'}
      </span>
      {capture}
    </Card>
  );
}
