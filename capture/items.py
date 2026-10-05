"""Item properties from 0x9C/0x9D item packets, worded like the game's tooltip.

The layout after the item header (verified on every item in the recordings): quality
data, runeword/personalized data, then by base defense, durability, quantity, sockets,
set bonus flags, and the stat lists. PD2 adds one bit after each stat id and before
each set bonus / runeword list. itemstats.json comes from scripts/extract_items.py.
"""
import json
import os
import re

try:
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'itemstats.json')) as f:
        DATA = json.load(f)
except (OSError, ValueError):
    DATA = None

F_SOCKETED, F_PERSONALIZED, F_RUNEWORD = 0x800, 0x1000000, 0x4000000
ARMOR_CLASS = 31
CORRUPTOR = 361  # set while an item is being corrupted (the cube); hidden in tooltips
# Stats saved as one id followed by the values of the next ones.
SAVE_GROUPS = {17: 2, 48: 2, 50: 2, 52: 2, 54: 3, 57: 3}
# Damage shown as one "Adds x-y" line: min stat, max stat, string key (length stat for poison).
RANGES = [(21, 22, 'MinDamage'), (48, 49, 'FireDamage'), (50, 51, 'LightningDamage'), (52, 53, 'MagicDamage'),
          (54, 55, 'ColdDamage'), (57, 58, 'PoisonDamage')]
# Merged lines named like the PD2 API's ("All Resistances +20" is all_resist); other groups
# keep their first stat's name (map_play_magicbonus for "Magic and Gold Find").
GROUP_NAMES = {1: 'all_attributes', 2: 'all_resist'}
# Shown only through another line (cold/poison durations).
HIDDEN = {56, 59}
# Two-handed and throw copies of min/max damage: shown only when the one-handed one isn't.
DAMAGE_COPIES = {23: 21, 24: 22, 159: 21, 160: 22}


def read_body(bits, flags, code, quality, info=None):
    """Everything after the graphic field of an identified item -> (set/unique index or
    None, [(stat id, value, param)] or None if unreadable). `info` gets 'sockets' (count)."""
    uid = None
    if bits.read(1): bits.read(11)   # class-specific automod
    if quality in (5, 7):
        uid = bits.read(12)
    try:
        return uid, _read_stats(bits, flags, code, quality, info if info is not None else {}) if DATA else None
    except EOFError:
        return uid, None


def _read_stats(bits, flags, code, quality, info):
    if quality in (1, 3):
        bits.read(3)
    elif quality == 4:
        bits.read(22)  # prefix, suffix
    elif quality in (6, 8):
        bits.read(16)  # name
        for _ in range(6):
            if bits.read(1): bits.read(11)
    if flags & F_RUNEWORD:
        bits.read(16)
    if flags & F_PERSONALIZED:
        while bits.read(7): pass
    if code in ('tbk', 'ibk'):
        bits.read(5)
    kind = DATA['items'].get(code, '')
    if 'a' in kind:
        bits.read(DATA['stats'][str(ARMOR_CLASS)]['save'][0])
    if 'a' in kind or 'd' in kind:
        if bits.read(8): bits.read(9)  # max / current durability
    if 's' in kind:
        bits.read(9)
    if flags & F_SOCKETED:
        info['sockets'] = bits.read(4)
    set_lists = bits.read(5) if quality == 5 else 0
    out = []
    if not stat_list(bits, out):
        return None
    for i in range(5):
        if set_lists >> i & 1:
            bits.read(1)
            if not stat_list(bits, []):  # set bonuses: not the item's own properties
                return None
    if flags & F_RUNEWORD:
        bits.read(1)
        if not stat_list(bits, out):
            return None
    return out


def stat_list(bits, out):
    stats = DATA['stats']
    while (sid := bits.read(9)) != 0x1FF:
        if str(sid) not in stats:
            return False
        bits.read(1)
        for k in range(SAVE_GROUPS.get(sid, 1)):
            width, add, param_bits = stats[str(sid + k)]['save']
            param = bits.read(param_bits) if param_bits else 0
            out.append((sid + k, bits.read(width) - add, param))
    return True


def _sprintf(fmt, *args):
    args = iter(args)
    return re.sub(r'%[+]?[ds]|%%', lambda m: '%' if m.group() == '%%' else str(next(args, '')), fmt)


def _place(value, s1, s2, where):
    if not where:
        value = ''
    parts = [s1, value, s2] if where == 2 else [value, s1, s2]
    return ' '.join(p for p in parts if p)


def _skill(sid):
    return DATA['skills'].get(str(sid), [f'skill {sid}', ''])


def describe_one(sid, value, param):
    """One stat's tooltip line, or None when the game doesn't show it."""
    info = DATA['stats'][str(sid)]
    func, where, s1, s2, _ = info['desc']
    signed = f'{value:+d}'
    # Like projectdiablo2.com, percentages go without a plus ("20% Increased Attack Speed");
    # map properties keep the game's own "+".
    pct = f'{signed}%' if info['name'].startswith('map_') else f'{value}%'
    classes = DATA['classes']
    if func in (1, 12):
        return _place(signed, s1, '', where)
    if func == 2:
        return _place(f'{value}%', s1, '', where)
    if func == 3:
        return _place(str(value), s1, '', where)
    if func == 4:
        return _place(pct, s1, '', where)
    if func == 5:
        return _place(f'{value * 100 // 128}%', s1, '', where)
    if func in (6, 7, 8, 9, 10):
        shown = {6: signed, 7: f'{value}%', 8: pct, 9: str(value), 10: f'{value * 100 // 128}%'}[func]
        if '%d' in s2:
            return f"{s1} {_sprintf(s2, value)}"
        return _place(shown, s1, s2, where)
    if func == 11:
        return f'Repairs 1 Durability in {100 // value if value else 0} Seconds'
    if func == 13:
        return f"{signed} {classes[param]['all']}" if param < len(classes) else None
    if func == 14:
        cls, tab = param >> 3, param & 7
        if cls < len(classes) and tab < 3:
            return f"{_sprintf(classes[cls]['tabs'][tab], value)} {classes[cls]['only']}"
        return None
    if func == 15:
        return _sprintf(s1, value, param & 63, _skill(param >> 6)[0])
    if func == 16:
        return _sprintf(s1, value, _skill(param)[0])
    if func in (17, 18):
        return _place(f'{signed}{"%" if func == 18 else ""}', s1, '', where)
    if func == 19:
        return _sprintf(s1, value).split('\n')[0]
    if func == 20:
        return _place(f'{-value}%', s1, '', where)
    if func == 21:
        return _place(str(-value), s1, '', where)
    if func in (22, 23):
        return _place(f'{value}%', s1, '', where)
    if func == 24:
        return _sprintf(s1, param & 63, _skill(param >> 6)[0], value & 255, value >> 8)
    if func in (27, 28):
        name, cls = _skill(param)
        only = next((c['only'] for c, code in zip(classes, DATA['classCodes']) if code == cls), '') if func == 27 else ''
        return ' '.join(p for p in (f'{signed} to {name}', only) if p)
    return None


def describe(stats):
    """[(stat id, value, param)] -> modifiers in the PD2 API's shape, most important first."""
    if not DATA or stats is None:
        return None
    by_id = {}
    for sid, value, param in stats:
        by_id.setdefault(sid, []).append((value, param))
    single = {sid: v[0][0] for sid, v in by_id.items() if len(v) == 1}
    mods, used = [], set()

    def add(sid, label, values, name=None):
        if label:
            info = DATA['stats'][str(sid)]
            mods.append({'name': name or info['name'], 'label': label, 'values': values, 'priority': info['desc'][4]})

    for lo, hi, key in RANGES:
        if lo in single and hi in single:
            a, b = single[lo], single[hi]
            if key == 'PoisonDamage':
                length = single.get(59, 0)
                a, b = round(a * length / 256), round(b * length / 256)
                secs = length // 25
                text = _sprintf(DATA['strings']['strModPoisonDamage' if a == b else 'strModPoisonDamageRange'], *((a, secs) if a == b else (a, b, secs)))
            else:
                text = _sprintf(DATA['strings'][f'strMod{key}' if a == b else f'strMod{key}Range'], *((a,) if a == b else (a, b)))
            add(hi, text.title().replace(' Over ', ' over '), [a, b])
            used |= {lo, hi}
    if 17 in single and 18 in single and single[17] == single[18]:
        add(17, f'+{single[17]}% Enhanced Damage', [single[17]])
        used |= {17, 18}
    # Groups shown as one line when every member has the same value (all resistances...).
    groups = {}
    for sid, info in DATA['stats'].items():
        if info['group']:
            groups.setdefault(info['group'][0], []).append(int(sid))
    for group, members in groups.items():
        values = {single.get(m) for m in members}
        if len(values) == 1 and None not in values and not used & set(members):
            value = values.pop()
            _, func, where, s1, s2 = DATA['stats'][str(members[0])]['group']
            percent = '%' if DATA['stats'][str(members[0])]['desc'][0] in (2, 4, 7, 8) else ''
            label = _sprintf(s1, value) + percent if func == 19 else _place(f'{value:+d}{percent}', s1, s2, where)
            add(members[0], label, [value], GROUP_NAMES.get(group))
            used |= set(members)
    for sid, entries in by_id.items():
        if sid in used or sid in HIDDEN or DAMAGE_COPIES.get(sid) in by_id:
            continue
        for value, param in entries:
            add(sid, describe_one(sid, value, param), [value])
    mods.sort(key=lambda m: -m['priority'])
    return mods
