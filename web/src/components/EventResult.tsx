import { ItemIcon } from './ItemIcon';
import { ItemPile } from './ItemPile';
import { EVENT_REWARDS, asItem, baseName, type RunEvent } from '../lib/capture';
import { fmtCompact, fmtNumber } from '../lib/series';
import { levelOf } from '../lib/xp';

/** "Key of Hate" -> "Hate"; other rewards keep their name. */
const shortName = (code: string) => baseName(code).replace(/^Key of /, '');

/**
 * What a map event produced, compact: reward items with counts (keys from a Spire,
 * catalysts from an altar, a pile on hover for Treasure Fallen), Gheed's shop offer, how
 * many invaders came, the experience from Mendeln's undead.
 */
export function EventResult({ event, defeated, entered }: { event: RunEvent; defeated?: boolean; entered?: boolean }) {
  const reward = EVENT_REWARDS[event.kind];
  const drops = Object.keys(event.data?.drops ?? {});

  if (event.kind === 'horazon') {
    return <span className="text-xs text-muted">{defeated ? (entered ? 'defeated · portal entered' : 'defeated · portal not entered') : 'not defeated'}</span>;
  }
  if (event.kind === 'gheed') {
    const shop = event.data?.shop ?? [];
    if (!shop.length) return <span className="text-xs text-muted">shop not opened</span>;
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
        {shop.map((s) => {
          const item = asItem({ code: s.code, quality: s.quality ?? null, uid: null, ethereal: s.ethereal });
          return (
            <span
              key={s.unit}
              className="flex items-center gap-1"
              title={`${s.name ?? `Unique ${baseName(s.code)}`}${s.bought ? ' · bought' : ''}`}
            >
              <ItemIcon item={item} box={18} />
              {s.bought ? <span className="text-q-unique">{s.name ?? 'bought'}</span> : <span className="text-faint">{baseName(s.code)}</span>}
            </span>
          );
        })}
      </span>
    );
  }
  if (!reward) return null;
  const invaders = event.data?.invaders ?? [];
  const who = invaders.length > 0 && (
    <span className="text-xs text-muted" title={invaders.join(', ')}>
      {invaders.length} {invaders.length === 1 ? 'invader' : 'invaders'}
    </span>
  );
  // Of the character's level: levels gained by it, which spans a level-up.
  const xpTotal = event.data?.xpTotal;
  const ofLevel = event.data?.xp && xpTotal ? levelOf(xpTotal) - levelOf(xpTotal - event.data.xp) : null;
  const xp = event.data?.xp ? (
    <span className="text-xs text-muted" title={`${fmtNumber(event.data.xp)} experience from Mendeln and his undead`}>
      +{fmtCompact(event.data.xp)} xp{ofLevel !== null && ` · ${(ofLevel * 100).toFixed(1)}% of a level`}
    </span>
  ) : null;
  if (!drops.length) return <span className="flex items-center gap-2">{who}<span className="text-xs text-muted">no {reward.noun}</span>{xp}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1" title={reward.approx ? 'Dropped within 2 minutes of the event (approximate)' : undefined}>
      {who && <span className="mr-1">{who}</span>}
      <ItemPile counts={event.data!.drops!} noun={reward.noun} shortName={shortName} />
      {reward.approx && <span className="text-xs text-muted">(approx.)</span>}
      {xp && <span className="ml-1">{xp}</span>}
    </span>
  );
}
