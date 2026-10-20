"""PD2's monsters-left counter (0xAD, 6 bytes: shown flag + u32): python3 test_monsters_left.py"""
import struct
import pd2capture as pc

# A chunk holding the counter then another packet: the counter must not swallow what follows.
chunk = struct.pack('<BBI', 0xad, 1, 67) + bytes([0x02])
assert pc.s2c_size(chunk, 0) == 6 and pc.s2c_size(chunk, 6) == 1

evs = []
g = pc.Game(evs.append, 0.0, 'x', 1)
g.start(0.0)
g.on_server(0.1, struct.pack('<BBI', 0xad, 0, 0))    # hidden (town)
g.on_server(0.2, struct.pack('<BBI', 0xad, 1, 298))  # in the map
g.flush_kills(1.0)
g.on_server(2.0, struct.pack('<BBI', 0xad, 1, 67))
g.flush_kills(3.0)
g.on_server(4.0, struct.pack('<BBI', 0xad, 0, 0))    # back to town
g.flush_kills(5.0)
assert [e['left'] for e in evs if e['type'] == 'kills'] == [298, 67, None], evs
print('ok')
