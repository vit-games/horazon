"""Uber boss events from hand-built packets: python3 test_uber.py"""
import struct
import pd2capture as pc


def assign(g, ts, unit, cls, life=0x80):
    g.on_server(ts, struct.pack('<BIHHHB', 0xac, unit, cls, 0, 0, life) + bytes(4))


def hit(g, ts, unit, life):
    g.on_server(ts, struct.pack('<BBIBBB', 0x0c, 1, unit, 0x13, 0, life))


def dies(g, ts, unit):
    g.on_server(ts, struct.pack('<BIB', 0x69, unit, 0x08) + bytes(7))


evs = []
g = pc.Game(evs.append, 0.0, 'x', 1)
g.character = 'Vitsin'
g.set_area(0.5, 188)
assign(g, 1.0, 14, 1112)
hit(g, 1.5, 14, 0x60)  # down to 75%
g.on_server(2.0, bytes([0x5a, 0x06, 0x04]) + struct.pack('<I', 1112) + b'\x01' + b'Vitsin'.ljust(16, b'\0') + bytes(16))
lucion = [e for e in evs if e['type'] == 'uber_hp']
assert [(e['hp'], e['bosses']) for e in lucion] == [(75, {'Lucion': 75})], lucion  # reported on dying
dies(g, 3.0, 14)
dies(g, 3.1, 14)  # resent: no second kill

# Rathma: deaths in the earlier arenas don't count; both must die in the Void (163), whose
# HP alone is reported per boss, with the phase reached.
g.set_area(3.5, 162)
assign(g, 4.0, 20, 933)
assign(g, 4.0, 21, 934)
hit(g, 4.5, 20, 0x10)  # low in the Swamp: not the last fight
dies(g, 5.0, 20)
dies(g, 5.0, 21)
g.set_area(5.5, 163)
assign(g, 6.0, 30, 933)
assign(g, 6.0, 31, 934)
hit(g, 6.5, 31, 0x40)  # Mendeln at 50%
g.set_area(6.8, 109)  # leaves: reported
last = [e for e in evs if e['type'] == 'uber_hp'][-1]
assert last['bosses'] == {'Rathma': 100, 'Mendeln': 50} and last['phase'] == 3 and last['hp'] == 75, last
g.set_area(6.9, 163)
dies(g, 7.0, 30)
assert not any(e['type'] == 'uber_killed' and e['name'] == 'Rathma' for e in evs)
dies(g, 8.0, 31)
kinds = [(e['type'], e.get('killerName') or e.get('name')) for e in evs if e['type'] in ('death', 'uber_killed')]
assert kinds == [('death', 'Lucion'), ('uber_killed', 'Lucion'), ('uber_killed', 'Rathma')], kinds

# Recorded fights (capture/fixtures, local only: skipped when missing).
import os
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')


def replay(name):
    path = os.path.join(FIX, name)
    if not os.path.exists(path):
        print('skipped', name)
        return None
    out = []
    pc.replay(path, pc.Tracker(out.append))
    return out


# Uber Tristram, tier 0: three entries left alive through the portals, killed on the fourth.
ut = replay('uber-tristram-t0-4-entries-kill.pcap')
if ut is not None:
    used = [e for e in ut if e['type'] == 'uber_used']
    assert [(e['name'], e['tier']) for e in used] == [('Uber Tristram', 0)], used
    assert [e['area'] for e in ut if e['type'] == 'area'].count(185) == 4
    assert [e['name'] for e in ut if e['type'] == 'uber_killed'] == ['Uber Tristram']
    assert not [e for e in ut if e['type'] == 'death']
    lows = [e['bosses'] for e in ut if e['type'] == 'uber_hp']
    assert lows[0]['Mephisto'] == 0 and lows[-1] == {'Mephisto': 0, 'Diablo': 0, 'Baal': 0}, lows
# Lucion, tier 0: the summon, then Lucion kills the player at 93%.
lu = replay('lucion-t0-summon-death-midgame.pcap')
if lu is not None:
    assert [(e['name'], e['tier']) for e in lu if e['type'] == 'uber_used'] == [('Lucion', 0)]
    assert [e['hp'] for e in lu if e['type'] == 'uber_hp'][0] == 93
print('ok')
