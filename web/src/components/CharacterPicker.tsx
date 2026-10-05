import { ClassIcon } from './ClassIcon';
import type { CharacterInfo } from '../lib/types';
import { segGroup, segItem } from '../lib/ui';

type Character = Pick<CharacterInfo, 'name' | 'class' | 'level' | 'ladder'>;

/** Marks a non-ladder character (from an earlier season): its runs compare, but it isn't season progress. */
export function NonLadderTag() {
  return (
    <span className="rounded-sm border border-line px-1 text-xs leading-4 font-semibold tracking-wide text-muted" title="Non-ladder character">
      NL
    </span>
  );
}

/**
 * Character switch: one button per character with its class icon and level, so the
 * choice reads at a glance. `all` adds an "All" button (value '').
 */
export function CharacterPicker({
  characters,
  value,
  onChange,
  all,
}: {
  characters: Character[];
  value: string;
  onChange: (name: string) => void;
  all?: boolean;
}) {
  return (
    <div className={segGroup} role="radiogroup" aria-label="Character">
      {all && (
        <button role="radio" aria-checked={value === ''} className={segItem(value === '')} onClick={() => onChange('')}>
          All
        </button>
      )}
      {characters.map((c) => (
        <button
          key={c.name}
          role="radio"
          aria-checked={value === c.name}
          className={segItem(value === c.name)}
          title={[c.level && `Level ${c.level}`, c.class, c.ladder === false && '· non-ladder (left out of season totals)'].filter(Boolean).join(' ') || undefined}
          onClick={() => onChange(c.name)}
        >
          <span className={value === c.name ? '' : 'opacity-60'}>
            <ClassIcon cls={c.class} />
          </span>
          <span>{c.name}</span>
          {c.level != null && <span className="text-xs text-muted tabular-nums" aria-label={`level ${c.level}`}>lv {c.level}</span>}
          {c.ladder === false && <NonLadderTag />}
        </button>
      ))}
    </div>
  );
}
