#!/usr/bin/env python3
"""Checks the kernel port filter without privileges: a unix datagram socket runs the same
BPF program over whatever is sent to it. Linux only.  python3 capture/test_filter.py"""
import socket, struct

import pd2capture as c


def v4(sport, dport, proto=6, frag=0, options=b''):
    ihl = 5 + len(options) // 4
    return struct.pack('>BBHHHBBH4s4s', 0x40 | ihl, 0, 0, 0, frag, 64, proto, 0, bytes(4), bytes(4)) + options + struct.pack('>HH', sport, dport) + bytes(16)


def v6(sport, dport, proto=6):
    return struct.pack('>IHBB16s16s', 0x60000000, 20, proto, 64, bytes(16), bytes(16)) + struct.pack('>HH', sport, dport) + bytes(16)


CASES = [
    (v4(50000, 4000), True), (v4(4000, 50000), True), (v4(50000, 4000, options=bytes(8)), True),
    (v6(50000, 4000), True), (v6(4000, 50000), True),
    (v4(50000, 443), False), (v6(443, 50000), False),
    (v4(50000, 4000, proto=17), False), (v6(50000, 4000, proto=17), False),
    (v4(50000, 4000, frag=100), False),     # a later fragment: those bytes are no ports
    (v4(4000, 4000)[:21], False),           # cut short
    (b'\x00' * 40, False),
]

if __name__ == '__main__':
    tx, rx = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
    c.attach_filter(rx, c.port_filter(c.GAME_PORT))
    rx.setblocking(False)
    for i, (pkt, keep) in enumerate(CASES):
        tx.send(pkt)
        try:
            got = rx.recv(65535) == pkt
        except BlockingIOError:
            got = False
        assert got == keep, f'case {i}: expected {"kept" if keep else "dropped"}'
    print(f'{len(CASES)} cases ok')
