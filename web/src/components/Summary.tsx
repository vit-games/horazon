import { GROUP_COLOR, GROUP_LABEL, type Group } from '../lib/itemStyle';
import { Segmented } from './Segmented';

/** Per-group drop counts as the segmented filter line; each segment toggles its group. */
export function Summary({
  groups,
  counts,
  total,
  active,
  onToggle,
  onClear,
  scope,
}: {
  groups: readonly Group[];
  counts: Record<Group, number>;
  total: number;
  active: Set<Group>;
  onToggle: (g: Group) => void;
  onClear: () => void;
  /** The period the counts cover ("This season"), said once in front of them. */
  scope?: string;
}) {
  return (
    <>
    {scope && <span className="text-sm text-muted">{scope}</span>}
    <Segmented
      label={scope ? `Filter by kind, counts ${scope.toLowerCase()}` : 'Filter by kind'}
      total={total}
      options={groups.map((g) => ({ key: g, label: GROUP_LABEL[g], count: counts[g], className: GROUP_COLOR[g] }))}
      active={[...active]}
      onToggle={onToggle}
      onClear={onClear}
    />
    </>
  );
}
