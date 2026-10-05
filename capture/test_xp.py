"""Experience from hand-built packets: python3 test_xp.py"""
import struct
import pd2capture as pc

evs = []
g = pc.Game(evs.append, 0.0, 'x', 1)
g.start(0.0)
g.on_server(0.1, struct.pack('<BI', 0x1c, 1_000_000))  # join: absolute
g.on_server(1.0, bytes([0x1a, 200]))
g.on_server(1.1, struct.pack('<BH', 0x1b, 40_000))
g.on_server(2.0, struct.pack('<BI', 0x1c, 940_200))     # death: lost 100,000
g.on_server(3.0, struct.pack('<BI', 0x1c, 1_015_200))   # corpse: 75,000 back
g.on_server(4.0, struct.pack('<BI', 0x1c, 1_115_200))   # a big kill, nothing owed: a gain
g.end(5.0)
xp = [(e['xp'], e['lost']) for e in evs if e['type'] == 'xp']
assert xp == [(1_000_000, 0), (940_200, 100_000), (1_015_200, 25_000), (1_115_200, 25_000)], xp

# Shadow of Mendeln: gains go to his undead by their share of the deaths since the last gain.
evs = []
g = pc.Game(evs.append, 0.0, 'x', 1)
g.start(0.0)
g.on_server(0.1, struct.pack('<BI', 0x1c, 1_000_000))
for unit, cls in ((1, 923), (2, 926), (3, 821)):  # two of his undead, a map monster
    g.on_server(0.2, struct.pack('<BIH', 0xac, unit, cls) + bytes(10))
for unit in (1, 2, 3):
    g.on_server(0.3, struct.pack('<BIB', 0x69, unit, 0x08) + bytes(8))
g.on_server(0.4, struct.pack('<BH', 0x1b, 9_000))      # 2 of 3 deaths: 6,000
g.on_server(0.5, struct.pack('<BH', 0x1b, 500))        # no deaths since: nothing
g.end(1.0)
assert [e['xp'] for e in evs if e['type'] == 'mendeln_xp'] == [6_000], evs

# Map events from the units they bring, each unit once: Mendeln (twice sent), an invader, the altar.
evs = []
g = pc.Game(evs.append, 0.0, 'x', 1)
for p in (struct.pack('<BIH', 0xac, 9, 922), struct.pack('<BIH', 0xac, 9, 922), struct.pack('<BIH', 0xac, 10, 1188)):
    g.on_server(0.1, p + bytes(10))
g.on_server(0.2, struct.pack('<BBIH', 0x51, 2, 11, 611) + bytes(6))
assert [(e['event'], e.get('invader')) for e in evs if e['type'] == 'map_event'] == \
    [('mendeln', None), ('invaders', 'Paladin'), ('catalyst_altar', None)], evs
print('ok')
