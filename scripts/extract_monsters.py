#!/usr/bin/env python3
"""Extract PD2's map bosses and never-counted monsters from the local game install into
capture/bosses.json and capture/nevercount.json.

The capture sidecar recognises a map's boss by its monster class (the hcIdx row of
monstats.txt sent in the "assign NPC" packet). PD2 flags its bosses in monstats
(`boss` = 1); that also covers map-event monsters, ubers and boss minions, which are
left out below by their monstats Id. Re-run for each new season (new maps):

  python3 scripts/extract_monsters.py "/path/to/Diablo II/ProjectD2"

nevercount.json lists the classes monstats flags `neverCount` (monster-cast hydras, the
players' own summons...): their deaths are no kills, so the capture leaves them out.
COUNTED_ANYWAY are flagged too but PD2's `.kills` counts them (checked against recordings).
"""
import csv
import io
import json
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from mpq import MPQ  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', 'capture', 'bosses.json')
NEVER_COUNT_OUT = os.path.join(os.path.dirname(__file__), '..', 'capture', 'nevercount.json')
# Diablo II's own monsters (1.13 monstats has 734 rows): act bosses and uniques, not maps.
LAST_D2_MONSTER = 733
NOT_MAP_BOSSES = {
    # map events: Horazon, Dark Wanderer / Mendeln (with their summons), Invaders
    'summonerMap', 'rathmaBone', 'rathmaBoneClone', 'rathmaPoison', 'rathmaPoisonClone', 'rathmaBloodGolem',
    'rathmaTotem', 'spireFire', 'InvaderAmazon', 'InvaderAssassin', 'InvaderBarbarian', 'InvaderDruid',
    'InvaderNecromancer', 'InvaderPaladin', 'InvaderSorceress',
    # ubers and other content
    'uberdiablonew', 'ubertrappedsoul1', 'ubertrappedsoul2', 'ubertrappedsoul3', 'ubertrappedsoul4',
    'ubertrappedsoul5', 'CowBoss', 'uberancientbarb1', 'uberancientbarb2', 'uberancientbarb3',
    # minions and mini-bosses inside maps
    'willowispminion', 'willowispminion2', 'cantorbossbear', 'griswoldgolem', 'torajanBossPoisonEgg',
    'torajanBossMaggot', 'siegebeastMapBossFallen', 'fallenMarketBoss', 'ImperialPalaceBossMinion',
    'ImperialPalaceMiniBoss', 'ZharMiniBossBigHead', 'ZharMiniBossBaboon', 'ZharMiniBossCantor',
    'WarlordMiniBossShaman', 'WarlordMiniBossDefiler', 'CityofUrehMiniBoss', 'UrehRanger',
}
# neverCount in monstats, yet `.kills` counts them: Trapped Souls that PD2 maps spawn as ordinary packs
# (2026-10-05: a T3 map's 20 trappedsoul1/2 deaths were exactly the gap to two .kills readings).
# Unchecked, possibly the same: ubertrappedsoul1-5, duntrappedsoul, rathmaVoidGolem/BloodGolem, treasurefallenMap.
COUNTED_ANYWAY = {'trappedsoul1', 'trappedsoul2'}


def string_table(data):
    """D2 .tbl string table -> {key: text}."""
    count, hash_size = struct.unpack_from('<HI', data, 2)
    nodes = 21 + count * 2
    out = {}
    for i in range(hash_size):
        used, _, _, key_at, text_at, length = struct.unpack_from('<BHIIIH', data, nodes + i * 17)
        if used and key_at < len(data) and text_at < len(data):
            key = data[key_at:data.index(0, key_at)].decode('latin1')
            out[key] = data[text_at:text_at + length].rstrip(b'\0').decode('utf-8', 'replace')
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    archive = MPQ(os.path.join(sys.argv[1], 'pd2data.mpq'))
    rows = list(csv.reader(io.StringIO(archive.read(r'data\global\excel\monstats.txt').decode('latin1')), delimiter='\t'))
    strings = string_table(archive.read(r'data\local\LNG\ENG\patchstring.tbl'))
    head = rows[0]
    bosses = {}
    never = []
    for row in rows[1:]:
        m = dict(zip(head, row))
        if m.get('neverCount') == '1' and m.get('hcIdx', '').isdigit() and m['Id'] not in COUNTED_ANYWAY:
            never.append(int(m['hcIdx']))
        if m.get('boss') != '1' or not m.get('hcIdx', '').isdigit() or m['Id'] in NOT_MAP_BOSSES:
            continue
        idx = int(m['hcIdx'])
        if idx <= LAST_D2_MONSTER:
            continue
        # Names carry colour codes (ÿc4...).
        name = re.sub('\u00ffc.', '', strings.get(m['NameStr'], m['NameStr'])).strip()
        bosses[str(idx)] = name
    with open(OUT, 'w') as f:
        json.dump(dict(sorted(bosses.items(), key=lambda kv: int(kv[0]))), f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'{len(bosses)} map bosses -> {os.path.normpath(OUT)}')
    with open(NEVER_COUNT_OUT, 'w') as f:
        json.dump(sorted(never), f)
        f.write('\n')
    print(f'{len(never)} never-counted monster classes -> {os.path.normpath(NEVER_COUNT_OUT)}')


if __name__ == '__main__':
    main()
