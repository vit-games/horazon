import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CLASSES, ClassIcon } from './ClassIcon';
import { EventIcon } from './EventIcon';
import { TierKey } from './HaulHero';
import { KillRateChart } from './KillRateChart';
import { NewMark } from './NewTag';
import { PinIcon } from './PinIcon';
import { Portal } from './Portal';
import { RAMP } from './ActivityCalendar';
import { EVENTS, MAP_CONTENT, densityColor } from '../lib/capture';
import { CONTENT_LABEL } from '../lib/runFilter';

const SAMPLE_RATE = { avg: 300, step: 30, bars: [180, 260, 340, 300, 380, 290, 420, 310, 360, 270, 330, 390] };

function Row({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <>
      <dt className="flex min-h-6 items-center justify-end gap-1.5 whitespace-nowrap">{mark}</dt>
      <dd className="self-center text-muted">{children}</dd>
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="border-b border-line pb-1 font-sans text-sm font-semibold text-text">{title}</h3>
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-sm">{children}</dl>
    </section>
  );
}

/**
 * Every mark the app uses and what it means, one key reachable from every screen: the "?"
 * in the status strip, or the ? key. Not modal: it closes on Esc, a click outside, or ? again.
 */
export function SymbolKey() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setOpen(false);
      const t = e.target as HTMLElement;
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    // Switching section (rail, 1-7) closes it, like a click outside.
    const onHash = () => setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        className={`flex h-6 w-6 items-center justify-center rounded-full border font-num text-sm font-semibold ${
          open ? 'border-accent text-accent' : 'border-line text-muted hover:border-accent/60 hover:text-text'
        }`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="symbol-key"
        title="What the symbols mean (?)"
        aria-label="Symbol key"
      >
        ?
      </button>
      {open && (
        <div
          id="symbol-key"
          role="region"
          aria-label="Symbol key"
          className="absolute top-full right-0 z-30 mt-2 max-h-[min(78vh,760px)] w-[min(860px,calc(100vw-2rem))] overflow-y-auto rounded-sm border border-line bg-panel p-5 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)]"
        >
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-lg text-text">Symbol key</h2>
            <span className="text-xs text-muted">
              <kbd className="font-num text-text">?</kbd> opens and closes this · <kbd className="font-num text-text">Esc</kbd> closes
            </span>
          </div>
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
            <div className="flex flex-col gap-6">
              <Group title="Status">
                <Row mark={<Portal state="live" size={22} />}>Recording a game: the portal turns</Row>
                <Row mark={<Portal state="idle" size={22} />}>No game running</Row>
                <Row mark={<Portal state="error" size={22} />}>A source is failing; the status line says which, with a link to fix it</Row>
                <Row mark={<span className="h-2 w-2 rotate-45 border border-warn" />}>Something isn't set up yet (amber)</Row>
                <Row mark={<span className="h-2 w-2 rotate-45 bg-q-red" />}>Something is failing (red)</Row>
              </Group>
              <Group title="Items">
                <Row mark={<span className="font-semibold text-q-unique">Name</span>}>
                  Item names use the game's colours: <span className="text-q-unique">unique</span>, <span className="text-q-set">set</span>,{' '}
                  <span className="text-q-rare">rare</span>, <span className="text-q-magic">magic</span>, <span className="text-q-crafted">crafted</span>
                </Row>
                <Row mark={<NewMark size={16} />}>First time found: new for the grail</Row>
                <Row mark={<span className="font-num text-xs font-semibold tracking-[0.08em] text-muted uppercase">Tier</span>}>
                  <span className="flex flex-col gap-1">
                    <TierKey />
                    Your tiers, as the stripe on rows and cards; set them in Drops → Tiers
                  </span>
                </Row>
                <Row mark={<span className="text-xs text-q-red">Corrupted: CBF</span>}>What a corruption added to the item</Row>
                <Row mark={<span className="text-xs font-semibold text-brick">→ bricked</span>}>A slam that turned the item rare</Row>
                <Row mark={<span className="text-accent"><PinIcon filled /></span>}>Pinned to a haul card on Drops (drag a drop onto a card)</Row>
              </Group>
              <Group title="Classes">
                {CLASSES.map((c) => (
                  <Row key={c} mark={<ClassIcon cls={c} />}>
                    {c}
                  </Row>
                ))}
              </Group>
              <Group title="Calendars">
                <Row mark={<span className="h-2 w-20 rounded-sm" style={{ background: `linear-gradient(to right, ${RAMP.join(',')})` }} />}>
                  Less play to more: brighter days are busier
                </Row>
              </Group>
              <Group title="Keys">
                <Row mark={<kbd className="font-num text-text">1 – 7</kbd>}>Switch section (the numbers in the rail)</Row>
                <Row mark={<kbd className="font-num text-text">/</kbd>}>Jump to the page's search</Row>
                <Row mark={<kbd className="font-num text-text">?</kbd>}>This key</Row>
              </Group>
            </div>
            <div className="flex flex-col gap-6">
              <Group title="Map runs">
                <Row mark={<EventIcon kind="corrupted" className="text-q-red" />}>Corrupted map</Row>
                <Row mark={<EventIcon kind="heroic" className="text-q-unique" />}>Heroic map (Standard of Heroes)</Row>
                <Row mark={<EventIcon kind="catalyzed" className="text-q-magic" />}>Catalyzed map (Catalyst Shard: a random event)</Row>
                <Row mark={<EventIcon kind="map_glob_skirmish_mode" className="text-q-gray" />}>Fortified map</Row>
                <Row mark={<span className="flex items-center gap-1 font-num text-q-set"><EventIcon kind="boss" className="text-q-set" />4:40</span>}>
                  Map boss killed, at this time inside the map
                </Row>
                <Row mark={<span className="flex items-center gap-1 text-muted"><EventIcon kind="boss" className="text-muted" /><span className="text-xs">skipped</span></span>}>
                  The boss didn't die in this run
                </Row>
                <Row mark={<span className="font-num font-semibold text-q-set">−0:16</span>}>Ahead of your best clear (red: behind)</Row>
                <Row mark={<span className="font-num font-semibold text-q-set">fastest −0:38</span>}>Faster than every earlier clear of this map</Row>
                <Row mark={<span className="font-num font-semibold" style={{ color: densityColor(91) }}>+91%</span>}>Monster density of the map</Row>
                <Row mark={<KillRateChart rate={SAMPLE_RATE} width={64} height={18} className="text-muted" />}>Kills per minute through the run</Row>
                <Row mark={<span className="font-num">~233</span>}>Approximate: from the game's own kill counter</Row>
                <Row mark={<span className="text-xs text-q-set">live</span>}>The run is still being played</Row>
              </Group>
              <Group title="Map events">
                {EVENTS.map((e) => (
                  <Row key={e.kind} mark={<EventIcon kind={e.kind} />}>
                    <span className="text-text">{e.label}</span> · {e.reward}
                  </Row>
                ))}
              </Group>
              <Group title="Map monsters">
                {MAP_CONTENT.filter((k) => CONTENT_LABEL[k]).map((k) => (
                  <Row key={k} mark={<EventIcon kind={k} />}>
                    {CONTENT_LABEL[k]}
                  </Row>
                ))}
              </Group>
            </div>
          </div>
          <p className="mt-5 border-t border-line pt-3 text-xs text-muted">Most marks also explain themselves on hover.</p>
        </div>
      )}
    </div>
  );
}

