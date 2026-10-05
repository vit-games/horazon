#!/usr/bin/env python3
"""Extract PD2's item stat layout from the local game install into capture/itemstats.json.

The capture sidecar reads item properties from item packets (capture/items.py): the
bit layout comes from itemstatcost.txt ("Save Bits" / "Save Add" / "Save Param Bits"),
the tooltip wording from its desc* columns and the string tables, and the item
tables say which bases carry defense, durability or a quantity. Re-run for each new
season:

  python3 scripts/extract_items.py "/path/to/Diablo II"
"""
import csv
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from extract_monsters import string_table  # noqa: E402
from mpq import MPQ  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', 'capture', 'itemstats.json')
CLASS_CODES = ['ama', 'sor', 'nec', 'pal', 'bar', 'dru', 'ass']


def table(archive, name):
    text = archive.read(rf'data\global\excel\{name}.txt').decode('latin1')
    return list(csv.DictReader(io.StringIO(text), delimiter='\t'))


def num(row, key):
    v = (row.get(key) or '').strip()
    return int(v) if v.lstrip('-').isdigit() else 0


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    root = sys.argv[1]
    pd2 = MPQ(os.path.join(root, 'ProjectD2', 'pd2data.mpq'))
    strings = {}
    for archive, name in (('d2data.mpq', 'string'), ('d2exp.mpq', 'expansionstring'), ('patch_d2.mpq', 'patchstring')):
        strings.update(string_table(MPQ(os.path.join(root, archive)).read(rf'data\local\LNG\ENG\{name}.tbl')))
    for name in ('string', 'expansionstring', 'patchstring'):
        data = pd2.read(rf'data\local\LNG\ENG\{name}.tbl')
        if data:
            strings.update(string_table(data))
    text = lambda key: re.sub(r'ÿc.', '', strings.get(key, key)).strip() if key else ''

    stats = {}
    for row in table(pd2, 'itemstatcost'):
        if not row['ID'].isdigit():
            continue
        stats[row['ID']] = {
            'name': row['Stat'],
            'save': [num(row, 'Save Bits'), num(row, 'Save Add'), num(row, 'Save Param Bits')],
            # descfunc, descval, descstrpos, descstr2, descpriority
            'desc': [num(row, 'descfunc'), num(row, 'descval'), text(row['descstrpos']), text(row['descstr2']), num(row, 'descpriority')],
            # stats shown as one line when all of the group have the same value ("All Resistances +20")
            'group': [num(row, 'dgrp'), num(row, 'dgrpfunc'), num(row, 'dgrpval'), text(row['dgrpstrpos']), text(row['dgrpstr2'])] if num(row, 'dgrp') else None,
        }

    descs = {r['skilldesc']: text(r['str name']) for r in table(pd2, 'skilldesc') if r['skilldesc']}
    skills = {r['Id']: [descs.get(r['skilldesc']) or r['skill'], r['charclass']] for r in table(pd2, 'skills') if r['Id'].isdigit()}
    classes = []
    for r in table(pd2, 'charstats'):
        if r['class'] and r['class'] != 'Expansion':
            classes.append({'name': r['class'], 'all': text(r['StrAllSkills']), 'only': text(r['StrClassOnly']),
                            'tabs': [text(r[f'StrSkillTab{i}']) for i in (1, 2, 3)]})

    items = {}
    for kind in ('armor', 'weapons', 'misc'):
        for r in table(pd2, kind):
            if r['code']:
                # a = armor (defense), d = durability, s = stackable (quantity)
                flags = ('a' if kind == 'armor' else '') + ('d' if kind != 'misc' and r.get('nodurability') != '1' else '') + ('s' if r.get('stackable') == '1' else '')
                if flags:
                    items[r['code']] = flags
    names = {k: text(k) for k in ('strModMinDamageRange', 'strModMinDamage', 'strModFireDamageRange', 'strModFireDamage',
                                  'strModLightningDamageRange', 'strModLightningDamage', 'strModMagicDamageRange', 'strModMagicDamage',
                                  'strModColdDamageRange', 'strModColdDamage', 'strModPoisonDamageRange', 'strModPoisonDamage')}
    with open(OUT, 'w') as f:
        json.dump({'stats': stats, 'skills': skills, 'classes': classes, 'classCodes': CLASS_CODES, 'items': items, 'strings': names},
                  f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(stats)} stats, {len(skills)} skills, {len(items)} bases -> {os.path.normpath(OUT)}')


if __name__ == '__main__':
    main()
