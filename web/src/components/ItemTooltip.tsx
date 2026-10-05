import { useLayoutEffect, useRef, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { nameColor } from '../lib/itemStyle';
import { runeNumber } from '../lib/runes';
import type { Item, Modifier } from '../lib/types';

function range(m: Modifier) {
  return m.min !== undefined && m.max !== undefined && m.min < m.max ? ` [${m.min}-${m.max}]` : '';
}

/** The "Corrupted" marker line itself (shown last, like in game). */
const isCorruptedMarker = (m: Modifier) => m.label === 'Corrupted';

/** In-game style tooltip: name, base, core stats, requirements, then magic properties. */
export function ItemTooltipBody({ item }: { item: Item }) {
  const color = nameColor(item);
  const q = item.quality?.name;
  // The base under the name - unless the name is the base already (rares/crafts the capture can't name).
  const showBase = !item.is_simple && ['Unique', 'Set', 'Rare', 'Crafted'].includes(q) && item.is_identified && item.name !== item.base?.name;
  const mods = [...(item.modifiers ?? [])].sort((a, b) => b.priority - a.priority);
  const props = mods.filter((m) => !isCorruptedMarker(m) && m.name !== 'item_shiny_appearance');
  const corrupted = item.corrupted || mods.some((m) => isCorruptedMarker(m) || m.corrupted);
  const req = item.requirements ?? {};
  const dmg = item.damage ?? {};

  const trailer = item.is_ethereal ? 'Ethereal (Cannot be Repaired)' : '';
  // A corruption that added no line gave sockets: shown red like the slammed lines.
  const slammedSockets = corrupted && item.socket_count > 0 && !props.some((m) => m.corrupted);
  const sockets = item.socket_count > 0 ? `${item.socket_count} OS` : '';

  return (
    <div className="flex flex-col items-center gap-2 text-center text-[13px] leading-[1.35]">
      <ItemIcon item={item} />
      <div>
        <div className={`text-[15px] font-medium ${color}`}>
          {item.name}
          {item.quantity && item.quantity > 1 ? ` ×${item.quantity}` : ''}
        </div>
        {showBase && <div className={`text-[15px] font-medium ${color}`}>{item.base.name}</div>}
      </div>

      <div className="text-q-normal">
        {item.defense && <div>Defense: <span className={item.defense.total && item.defense.total > item.defense.base ? 'text-q-magic' : ''}>{item.defense.total ?? item.defense.base}</span></div>}
        {dmg.one_handed?.minimum !== undefined && <div>One-Hand Damage: {dmg.one_handed.minimum} to {dmg.one_handed.maximum}</div>}
        {dmg.two_handed?.minimum !== undefined && <div>Two-Hand Damage: {dmg.two_handed.minimum} to {dmg.two_handed.maximum}</div>}
        {dmg.missile?.minimum !== undefined && <div>Throw Damage: {dmg.missile.minimum} to {dmg.missile.maximum}</div>}
        {!!req.dexterity && <div>Required Dexterity: {req.dexterity}</div>}
        {!!req.strength && <div>Required Strength: {req.strength}</div>}
        {!!req.level && <div>Required Level: {req.level}</div>}
        {item.item_level !== undefined && <div className="text-q-gray">Item Level: {item.item_level}</div>}
      </div>

      {!item.is_identified ? (
        <div className="text-q-red">Unidentified</div>
      ) : (
        (props.length > 0 || trailer || sockets || corrupted) && (
          <div className="text-q-magic">
            {props.map((m, i) => (
              // Lines added by corrupting (slamming) the item are red, as on projectdiablo2.com.
              <div key={i} className={m.corrupted ? 'text-q-red' : undefined} title={m.corrupted ? 'From corruption' : undefined}>
                {m.label}
                <span className="text-q-gray">{range(m)}</span>
              </div>
            ))}
            {(trailer || sockets) && (
              <div>
                {trailer}
                {trailer && sockets && ', '}
                {sockets && (
                  <span className={slammedSockets ? 'text-q-red' : undefined} title={slammedSockets ? 'From corruption' : undefined}>
                    {sockets}
                  </span>
                )}
              </div>
            )}
            {corrupted && <div className="text-q-red">Corrupted</div>}
          </div>
        )
      )}

    </div>
  );
}

/** Floating tooltip that follows the cursor and stays inside the viewport. */
export function FloatingTooltip({ item, x, y }: { item: Item; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 16, top: y + 16 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    let left = x + 20;
    if (left + width > window.innerWidth - pad) left = x - width - 20;
    let top = y - height / 2;
    top = Math.max(pad, Math.min(top, window.innerHeight - height - pad));
    setPos({ left: Math.max(pad, left), top });
  }, [x, y, item]);

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-50 max-w-[340px] min-w-[220px] rounded-sm border border-line bg-black/95 px-5 py-4 shadow-2xl shadow-black"
      style={pos}
    >
      <ItemTooltipBody item={item} />
    </div>
  );
}
