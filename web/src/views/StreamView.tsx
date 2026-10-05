import { useEffect, useState } from 'react';
import { GrailCounterCard, MomentsCard, OverlayBuilder, RunTrackerCard, SessionBoardCard } from '../components/OverlayBuilder';
import { Seg } from '../components/Seg';
import { fetchSettings } from '../lib/api';

const MINE_KEY = 'horazon.stream.mine';

/**
 * OBS overlays: what viewers see. Each card builds a Browser Source URL with a preview; previews show
 * sample data by default (a new install has none of its own), or the streamer's own data.
 */
export function StreamView() {
  const [characters, setCharacters] = useState<string[]>([]);
  const [mine, setMine] = useState(() => {
    try {
      return localStorage.getItem(MINE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    fetchSettings().then((s) => setCharacters(Object.keys(s.characters).sort()), () => {});
  }, []);
  const choose = (v: 'sample' | 'mine') => {
    setMine(v === 'mine');
    try {
      localStorage.setItem(MINE_KEY, v === 'mine' ? '1' : '0');
    } catch {
      // storage blocked: the choice lasts until reload
    }
  };
  return (
    <>
      {/* No page title: the rail names the page, as on every other one. */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <p className="max-w-[64ch] text-sm text-muted">
          In OBS: Sources → + → Browser, paste a URL below and enter the size beside it. Overlays update on their own while you play, so there is
          nothing to touch mid-game.
        </p>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted">Previews</span>
          <Seg
            options={[
              { key: 'sample', label: 'Sample data' },
              { key: 'mine', label: 'My data' },
            ]}
            value={mine ? 'mine' : 'sample'}
            onChange={choose}
          />
        </div>
      </div>
      {/* Runs lead, as everywhere: the run tracker and its moments first, then drops, grail and the scene. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <RunTrackerCard mine={mine} />
        <MomentsCard mine={mine} />
        <OverlayBuilder characters={characters} mine={mine} />
        <GrailCounterCard mine={mine} />
        <SessionBoardCard mine={mine} />
      </div>
    </>
  );
}
