import { useEffect, useState } from 'react';
import { fetchSettings, fetchSources } from './api';
import { fetchCaptureStatus, type CaptureStatus } from './capture';
import { useConnection } from './desktop';
import { useChanges } from './live';
import type { PortalState } from '../components/Portal';

/** A game counts as live while its last packet is this recent (as in the capture status bar). */
const LIVE_MS = 5 * 60e3;

export interface SystemStatus {
  capture: CaptureStatus | null;
  live: boolean;
  /** Why stash/armory polling is failing, in plain words; null when it works. */
  syncProblem: string | null;
  /** Polling not set up at all (no token, no active character); null otherwise. */
  syncGap: string | null;
  /** The latest successful poll of any source; null when nothing has been polled. */
  lastPoll: string | null;
  /** Why the desktop app isn't capturing when it should, in plain words; null when fine or unknown. */
  captureProblem: string | null;
  portal: PortalState;
}

/** Capture and polling health, for the status strip and the portal. Refreshes on server events. */
export function useSystemStatus(): SystemStatus {
  const [capture, setCapture] = useState<CaptureStatus | null>(null);
  const [syncProblem, setSyncProblem] = useState<string | null>(null);
  const [syncGap, setSyncGap] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<string | null>(null);
  const [, tick] = useState(0);
  const version = useChanges('live', 'sources', 'runs');
  const connection = useConnection();

  useEffect(() => {
    let cancelled = false;
    fetchCaptureStatus().then((c) => !cancelled && setCapture(c), () => {});
    Promise.all([fetchSources(), fetchSettings()]).then(([src, settings]) => {
      if (cancelled) return;
      const failing = src.sources.find((s) => s.last_error);
      const expired = settings.hasToken && settings.tokenExpires && new Date(settings.tokenExpires) < new Date();
      setSyncProblem(
        expired
          ? 'Stash token expired - stashed drops are not being recorded'
          : failing
            ? /401/.test(failing.last_error!)
              ? 'Stash token rejected - stashed drops are not being recorded'
              : `${failing.key.replace(':', ' ')}: ${failing.last_error}`
            : null,
      );
      const polling = Object.values(settings.characters).some(Boolean);
      // A missing token alone is said on Setup only: it isn't worth the strip on every alt-tab.
      setSyncGap(!settings.hasToken && !polling ? 'Nothing is checked - no stash token and no active character' : null);
      // A polling cycle with nothing to poll is not a sync.
      const polls = src.sources.flatMap((s) => (s.last_poll_at ? [s.last_poll_at] : [])).sort();
      setLastPoll(polls.at(-1) ?? null);
    }, () => {});
    return () => {
      cancelled = true;
    };
  }, [version]);

  // Re-evaluate "live" as time passes, even without events.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const game = capture?.game;
  // `?sample=1` (screenshots): the Session view shows the kill counter's sample run, so recording reads live.
  const sample = new URLSearchParams(location.search).get('sample') === '1';
  const live = sample || (!!game && Date.now() - new Date(game.last_event_at).getTime() < LIVE_MS);
  const c = connection?.capture;
  const captureProblem =
    c?.state === 'error'
      ? `Capture stopped: ${c.message}`
      : c?.state === 'no-permission'
        ? 'Capture needs permission - games are not being recorded'
        : connection?.game && c?.state === 'off'
          ? 'The game is running but capture is off'
          : null;
  const trouble = syncProblem || captureProblem;
  return { capture, live, syncProblem, syncGap, lastPoll, captureProblem, portal: trouble ? 'error' : live ? 'live' : 'idle' };
}
