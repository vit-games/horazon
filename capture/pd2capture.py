#!/usr/bin/env python3
"""Horazon capture sidecar: decodes PD2 game traffic into tracker events.

Reads the game connection passively (raw socket on the host, nothing touches the game
process), decodes the D2 1.13 game protocol PD2 uses and POSTs compact events to the
Horazon server. Player chat is never forwarded - only system notices (map events).

  pd2capture.py live   [--post URL] [--record-dir DIR] [--record FILE.pcap] [--bind IP]
      Linux: needs CAP_NET_RAW. Windows: run as Administrator; listens on the adapter
      that owns --bind (default: the one used to reach the internet), IPv4 only.
      --record-dir keeps one pcap per game (newest 40) for debugging/reprocessing
  pd2capture.py replay FILE.pcap [--post URL]             (prints events without --post)
  pd2capture.py live --control-dir DIR [--log-dir DIR]
      How the Windows desktop app runs it (an elevated scheduled task it can't signal):
      posts to the port in DIR/run.json and stops once DIR/stop exists.

Huffman decompression and packet layouts are ported from github.com/blacha/diablo2
(MIT); PD2-specific packet sizes were measured from live captures.
"""
import ctypes, json, os, queue, re, signal, socket, struct, sys, threading, time, urllib.request

# Before anything that can fail: pythonw (the Windows task) has nowhere else to print a traceback.
if '--log-dir' in sys.argv:
    _log_dir = sys.argv[sys.argv.index('--log-dir') + 1]
    os.makedirs(_log_dir, exist_ok=True)
    sys.stdout = sys.stderr = open(os.path.join(_log_dir, 'capture.log'), 'w', buffering=1)

import items

# ---------------------------------------------------------------- huffman
INDEX = [0x0247,0x0236,0x0225,0x0214,0x0203,0x01f2,0x01e1,0x01d0,0x01bf,0x01ae,0x019d,0x018c,0x017b,0x016a,
0x0161,0x0158,0x014f,0x0146,0x013d,0x0134,0x012b,0x0122,0x0119,0x0110,0x0107,0x00fe,0x00f5,0x00ec,
0x00e3,0x00da,0x00d1,0x00c8,0x00bf,0x00b6,0x00ad,0x00a8,0x00a3,0x009e,0x0099,0x0094,0x008f,0x008a,
0x0085,0x0080,0x007b,0x0076,0x0071,0x006c,0x0069,0x0066,0x0063,0x0060,0x005d,0x005a,0x0057,0x0054,
0x0051,0x004e,0x004b,0x0048,0x0045,0x0042,0x003f,0x003f,0x003c,0x003c,0x0039,0x0039,0x0036,0x0036,
0x0033,0x0033,0x0030,0x0030,0x002d,0x002d,0x002a,0x002a,0x0027,0x0027,0x0024,0x0024,0x0021,0x0021,
0x001e,0x001e,0x001b,0x001b,0x0018,0x0018,0x0015,0x0015,0x0012,0x0012,0x0012,0x0012,0x000f,0x000f,
0x000f,0x000f,0x000c,0x000c,0x000c,0x000c,0x0009,0x0009,0x0009,0x0009,0x0006,0x0006,0x0006,0x0006,
] + [0x0003] * 16 + [0x0000] * 128

CHARS = bytes([
0x00,0x00,0x01,0x00,0x01,0x04,0x00,0xff,0x06,0x00,0x14,0x06,0x00,0x13,0x06,0x00,0x05,0x06,0x00,
0x02,0x06,0x00,0x80,0x07,0x00,0x6d,0x07,0x00,0x69,0x07,0x00,0x68,0x07,0x00,0x67,0x07,0x00,0x1e,
0x07,0x00,0x15,0x07,0x00,0x12,0x07,0x00,0x0d,0x07,0x00,0x0a,0x07,0x00,0x08,0x07,0x00,0x07,0x07,
0x00,0x06,0x07,0x00,0x04,0x07,0x00,0x03,0x07,0x00,0x6c,0x08,0x00,0x51,0x08,0x00,0x20,0x08,0x00,
0x1f,0x08,0x00,0x1d,0x08,0x00,0x18,0x08,0x00,0x17,0x08,0x00,0x16,0x08,0x00,0x11,0x08,0x00,0x10,
0x08,0x00,0x0f,0x08,0x00,0x0c,0x08,0x00,0x0b,0x08,0x00,0x09,0x08,0x01,0x96,0x09,0x97,0x09,0x01,
0x90,0x09,0x95,0x09,0x01,0x64,0x09,0x6b,0x09,0x01,0x62,0x09,0x63,0x09,0x01,0x56,0x09,0x58,0x09,
0x01,0x52,0x09,0x55,0x09,0x01,0x4d,0x09,0x50,0x09,0x01,0x45,0x09,0x4c,0x09,0x01,0x40,0x09,0x43,
0x09,0x01,0x31,0x09,0x3b,0x09,0x01,0x28,0x09,0x30,0x09,0x01,0x1a,0x09,0x25,0x09,0x01,0x0e,0x09,
0x19,0x09,0x02,0xe2,0x0a,0xe8,0x0a,0xf0,0x0a,0xf8,0x0a,0x02,0xc0,0x0a,0xc2,0x0a,0xce,0x0a,0xe0,
0x0a,0x02,0xa0,0x0a,0xa2,0x0a,0xb0,0x0a,0xb8,0x0a,0x02,0x8a,0x0a,0x8f,0x0a,0x93,0x0a,0x98,0x0a,
0x02,0x81,0x0a,0x82,0x0a,0x83,0x0a,0x89,0x0a,0x02,0x7c,0x0a,0x7d,0x0a,0x7e,0x0a,0x7f,0x0a,0x02,
0x77,0x0a,0x78,0x0a,0x79,0x0a,0x7a,0x0a,0x02,0x73,0x0a,0x74,0x0a,0x75,0x0a,0x76,0x0a,0x02,0x6e,
0x0a,0x6f,0x0a,0x70,0x0a,0x72,0x0a,0x02,0x61,0x0a,0x65,0x0a,0x66,0x0a,0x6a,0x0a,0x02,0x5d,0x0a,
0x5e,0x0a,0x5f,0x0a,0x60,0x0a,0x02,0x57,0x0a,0x59,0x0a,0x5a,0x0a,0x5b,0x0a,0x02,0x4a,0x0a,0x4b,
0x0a,0x4e,0x0a,0x53,0x0a,0x02,0x46,0x0a,0x47,0x0a,0x48,0x0a,0x49,0x0a,0x02,0x3f,0x0a,0x41,0x0a,
0x42,0x0a,0x44,0x0a,0x02,0x3a,0x0a,0x3c,0x0a,0x3d,0x0a,0x3e,0x0a,0x02,0x36,0x0a,0x37,0x0a,0x38,
0x0a,0x39,0x0a,0x02,0x32,0x0a,0x33,0x0a,0x34,0x0a,0x35,0x0a,0x02,0x2b,0x0a,0x2c,0x0a,0x2d,0x0a,
0x2e,0x0a,0x02,0x26,0x0a,0x27,0x0a,0x29,0x0a,0x2a,0x0a,0x02,0x21,0x0a,0x22,0x0a,0x23,0x0a,0x24,
0x0a,0x03,0xfb,0x0b,0xfc,0x0b,0xfd,0x0b,0xfe,0x0b,0x1b,0x0a,0x1b,0x0a,0x1c,0x0a,0x1c,0x0a,0x03,
0xf2,0x0b,0xf3,0x0b,0xf4,0x0b,0xf5,0x0b,0xf6,0x0b,0xf7,0x0b,0xf9,0x0b,0xfa,0x0b,0x03,0xe9,0x0b,
0xea,0x0b,0xeb,0x0b,0xec,0x0b,0xed,0x0b,0xee,0x0b,0xef,0x0b,0xf1,0x0b,0x03,0xde,0x0b,0xdf,0x0b,
0xe1,0x0b,0xe3,0x0b,0xe4,0x0b,0xe5,0x0b,0xe6,0x0b,0xe7,0x0b,0x03,0xd6,0x0b,0xd7,0x0b,0xd8,0x0b,
0xd9,0x0b,0xda,0x0b,0xdb,0x0b,0xdc,0x0b,0xdd,0x0b,0x03,0xcd,0x0b,0xcf,0x0b,0xd0,0x0b,0xd1,0x0b,
0xd2,0x0b,0xd3,0x0b,0xd4,0x0b,0xd5,0x0b,0x03,0xc5,0x0b,0xc6,0x0b,0xc7,0x0b,0xc8,0x0b,0xc9,0x0b,
0xca,0x0b,0xcb,0x0b,0xcc,0x0b,0x03,0xbb,0x0b,0xbc,0x0b,0xbd,0x0b,0xbe,0x0b,0xbf,0x0b,0xc1,0x0b,
0xc3,0x0b,0xc4,0x0b,0x03,0xb2,0x0b,0xb3,0x0b,0xb4,0x0b,0xb5,0x0b,0xb6,0x0b,0xb7,0x0b,0xb9,0x0b,
0xba,0x0b,0x03,0xa9,0x0b,0xaa,0x0b,0xab,0x0b,0xac,0x0b,0xad,0x0b,0xae,0x0b,0xaf,0x0b,0xb1,0x0b,
0x03,0x9f,0x0b,0xa1,0x0b,0xa3,0x0b,0xa4,0x0b,0xa5,0x0b,0xa6,0x0b,0xa7,0x0b,0xa8,0x0b,0x03,0x92,
0x0b,0x94,0x0b,0x99,0x0b,0x9a,0x0b,0x9b,0x0b,0x9c,0x0b,0x9d,0x0b,0x9e,0x0b,0x03,0x86,0x0b,0x87,
0x0b,0x88,0x0b,0x8b,0x0b,0x8c,0x0b,0x8d,0x0b,0x8e,0x0b,0x91,0x0b,0x03,0x2f,0x0b,0x4f,0x0b,0x54,
0x0b,0x5c,0x0b,0x71,0x0b,0x7b,0x0b,0x84,0x0b,0x85,0x0b,
])
MASKS = [(1 << n) - 1 for n in range(16)]


# PD2 game servers listen here (the realm/lobby connections use other ports).
GAME_PORT = 4000


def whole_chunks(buf, n):
    """True if `buf` starts with n chunks that decode into known packets exactly, False if
    not, None until enough bytes arrived."""
    o = 0
    for _ in range(n):
        cs = chunk_size(buf[o:o + 2])
        if cs is None or len(buf) < o + cs[1]:
            return None
        hdr, size = cs
        if size <= hdr:
            return False
        try:
            out = decompress(bytes(buf[o:o + size]), hdr)
        except Exception:
            return False
        i = 0
        while i < len(out):
            k = s2c_size(out, i)
            if not k:
                return False
            i += k
        if i != len(out) or not out:
            return False
        o += size
    return True


def resync(st):
    """Find a chunk start in a stream that continues mid-chunk (after a gap, or picked up
    mid-game): drop data up to the first segment start where two whole chunks decode."""
    buf = st.data
    while buf:
        ok = whole_chunks(buf, 2)
        if ok is None:
            return False
        if ok:
            st.resync, st.starts = False, []
            return True
        base = st.seen - len(buf)
        nxt = next((s for s in st.starts if s > base), None)
        if nxt is None:
            buf.clear()
            return False
        del buf[:nxt - base]
    return False


def chunk_size(buf):
    """(header bytes, chunk bytes incl. header), or None until enough bytes arrived."""
    if not buf:
        return None
    if buf[0] < 0xF0:
        return 1, buf[0]
    if len(buf) < 2:
        return None
    return 2, ((buf[0] & 0x0F) << 8) | buf[1]


def decompress(chunk, hdr):
    i, size, out, b, count = hdr, len(chunk) - hdr, bytearray(), 0, 0x20
    while True:
        while size > 0 and count >= 8:
            count -= 8
            size -= 1
            b = (b | (chunk[i] << count)) & 0xFFFFFFFF
            i += 1
        idx = INDEX[b >> 24]
        a = CHARS[idx]
        d = (b >> (24 - a)) & MASKS[a]
        c = CHARS[idx + 2 * d + 2]
        count += c
        if count > 0x20:
            return bytes(out)
        out.append(CHARS[idx + 2 * d + 1])
        b = (b << c) & 0xFFFFFFFF


# ---------------------------------------------------------------- packet sizes
# Server -> client. Variable-size packets are handled in s2c_size().
S2C = {
    0x00: 1, 0x01: 9, 0x02: 1, 0x03: 12, 0x04: 1, 0x05: 1, 0x06: 1, 0x07: 6, 0x08: 6, 0x09: 11, 0x0a: 6, 0x0b: 6,
    0x0c: 9, 0x0d: 13, 0x0e: 12, 0x0f: 16, 0x10: 16, 0x11: 8, 0x12: 26, 0x13: 14, 0x14: 18, 0x15: 11, 0x16: 1,
    0x18: 15, 0x19: 2, 0x1a: 2, 0x1b: 3, 0x1c: 5, 0x1d: 3, 0x1e: 4, 0x1f: 6, 0x20: 10, 0x21: 12, 0x22: 12, 0x23: 13,
    0x24: 90, 0x25: 90, 0x27: 40, 0x2d: 5, 0x2e: 18, 0x2f: 11, 0x28: 103, 0x29: 97, 0x2a: 15, 0x2c: 8, 0x3e: 34, 0x3f: 8, 0x40: 13, 0x42: 6,
    0x45: 13, 0x47: 11, 0x48: 11, 0x4c: 16, 0x4d: 17, 0x4e: 7, 0x4f: 1, 0x50: 15, 0x51: 14, 0x52: 42, 0x53: 10,
    0x54: 10, 0x55: 3, 0x57: 1, 0x58: 14, 0x59: 26, 0x5a: 40, 0x5c: 5, 0x5d: 6, 0x5e: 38, 0x5f: 5, 0x60: 7, 0x61: 2,
    0x62: 7, 0x63: 21, 0x65: 7, 0x66: 5, 0x67: 16, 0x68: 21, 0x69: 12, 0x6a: 7, 0x6b: 16, 0x6c: 16, 0x6d: 10,
    0x6e: 1, 0x6f: 1, 0x70: 1, 0x71: 1, 0x72: 1, 0x73: 32, 0x74: 10, 0x75: 13, 0x76: 6, 0x77: 2, 0x78: 21, 0x79: 6,
    0x7a: 13, 0x7b: 8, 0x7c: 6, 0x7d: 18, 0x7e: 5, 0x7f: 10, 0x81: 20, 0x82: 29, 0x83: 16, 0x84: 4, 0x89: 2,
    0x8a: 6, 0x8b: 6, 0x8c: 11, 0x8d: 7, 0x8e: 10, 0x8f: 33, 0x90: 13, 0x91: 26, 0x92: 6, 0x93: 8, 0x95: 13,
    0x96: 9, 0x97: 1, 0x98: 7, 0x99: 16, 0x9a: 17, 0x9b: 7, 0x9e: 7, 0x9f: 8, 0xa0: 10, 0xa1: 7, 0xa2: 8, 0xa3: 24,
    0xa4: 3, 0xa5: 8, 0xa6: 1, 0xa7: 7, 0xa9: 7, 0xab: 7, 0xad: 9, 0xb0: 1, 0xb1: 53, 0xb2: 1, 0xb3: 5, 0xb4: 1,
    0xff: 1,
}

# Client -> server (only ones seen in PD2 captures; parsing stops at anything else).
C2S = {
    0x01: 5, 0x02: 9, 0x03: 5, 0x04: 9, 0x05: 5, 0x06: 9, 0x07: 9, 0x08: 5, 0x09: 9, 0x0a: 9, 0x0c: 5, 0x0d: 9,
    0x0e: 9, 0x0f: 5, 0x10: 9, 0x11: 9, 0x13: 9, 0x16: 13, 0x17: 5, 0x18: 17, 0x19: 5, 0x1a: 9, 0x1c: 3, 0x1d: 9,
    0x1f: 17, 0x20: 13, 0x21: 9, 0x22: 5, 0x23: 9, 0x24: 5, 0x25: 9, 0x26: 13, 0x27: 9, 0x28: 9, 0x29: 9, 0x2a: 9,
    0x2e: 5, 0x2f: 9, 0x30: 9, 0x32: 17, 0x33: 17, 0x38: 13, 0x3c: 9, 0x3f: 3, 0x40: 1, 0x41: 1, 0x49: 9, 0x4b: 9,
    0x4c: 9, 0x4f: 7, 0x50: 9, 0x5f: 5, 0x60: 1, 0x61: 3, 0x6b: 1, 0x6d: 13,
}


def s2c_size(b, o):
    pid = b[o]
    if pid in S2C:
        return S2C[pid]
    try:
        if pid in (0x9c, 0x9d): return b[o + 2]
        if pid in (0xa8, 0xaa): return b[o + 6]
        if pid == 0xac: return b[o + 12]
        if pid == 0x5b: return b[o + 1] | b[o + 2] << 8
        if pid == 0x94: return 6 + 3 * b[o + 1]
        if pid == 0x56: return 18 + b[o + 17]
        if pid == 0x26:
            end = b.index(0, o + 10)
            return b.index(0, end + 1) + 1 - o
    except (IndexError, ValueError):
        return None
    return None


# ---------------------------------------------------------------- items
ACT_ADD_TO_GROUND, ACT_TO_CONTAINER, ACT_REMOVE, ACT_ADD_TO_SHOP, ACT_UPDATE_STATS = 0, 4, 5, 0x0b, 0x15
PICKUP_ACTIONS = {1, 4, 0x0e, 0x12}  # to cursor, into a container, into the belt
ON_GROUND_ACTIONS = {2, 3}  # dropped by a player, re-sent when back in view
QUALITY = ['', 'inferior', 'normal', 'superior', 'magic', 'set', 'rare', 'unique', 'crafted']
F_IDENT, F_EAR, F_SIMPLE, F_ETH, F_GAMBLE = 0x10, 0x10000, 0x200000, 0x400000, 0x2000000
# Consumables picked up all the time - not worth an event.
JUNK = {'gld', 'hp1', 'hp2', 'hp3', 'hp4', 'hp5', 'mp1', 'mp2', 'mp3', 'mp4', 'mp5', 'rvs', 'rvl', 'yps', 'vps',
        'wms', 'isc', 'tsc', 'key', 'aqv', 'cqv', 'tbk', 'ibk'}
MAP_CODE = re.compile(r'^t[1-6][0-9a-z]$')
# Uber encounters by monster class (monstats hcIdx; wiki.projectdiablo2.com/wiki/Monsters#Ubers).
# An encounter is killed once every unit of it seen has died: the Prime Evils of Uber Tristram,
# the 1-3 Ancients chosen. Not in bosses.json: Rathma and Mendeln also appear in a map event.
# ponytail: guessed from how map bosses die - unverified on a real kill.
UBER_BOSSES = {1112: 'Lucion', 933: 'Rathma', 934: 'Rathma', 789: 'Diablo Clone',
               704: 'Uber Tristram', 705: 'Uber Tristram', 709: 'Uber Tristram',
               989: 'Uber Ancients', 990: 'Uber Ancients', 991: 'Uber Ancients'}
# Fights with phases in separate areas: killed when each of its classes dies in the last one.
UBER_ARENA = {'Rathma': 163}  # Necropolis Void, after the Swamp (162) and Jungle (161)
RATHMA_PHASES = [162, 161, 163]
# Each boss of an encounter by name, for its own HP.
UBER_NAMES = {933: 'Rathma', 934: 'Mendeln', 704: 'Mephisto', 705: 'Diablo', 709: 'Baal',
              989: 'Talic', 990: 'Madawc', 991: 'Korlic', 1112: 'Lucion', 789: 'Diablo Clone'}
# The Shadow of Mendeln map event (nihlathakMap) and the undead it summons (*NihlMinion).
MENDELN_CLASSES = range(922, 932)
# Map events told by the monster (monstats hcIdx) or object (objects.txt Id) they bring, which
# the client gets in the same batch as the event's notice. Gheed is told by his shop (server)
# and his notice; Spire and the Dark Wanderer (whose rares come from the whole game) by the notice.
# ponytail: Horazon, Treasure Fallen and the invaders are from monstats, not yet seen in a trace.
EVENT_MONSTERS = {922: 'mendeln', 919: 'horazon', 945: 'treasure_fallen',
                  1183: 'Amazon', 1184: 'Assassin', 1185: 'Barbarian', 1186: 'Druid', 1187: 'Necromancer',
                  1188: 'Paladin', 1189: 'Sorceress'}  # the invaders by class
EVENT_OBJECTS = {611: 'catalyst_altar'}  # ForceShardAltar
# Items that summon an uber encounter (right-click); cubing sets their tier. Keys and organs
# (Izual, Lilith, Duriel) only lead up to Uber Tristram - not tracked.
UBER_CODES = {'luca': 'Lucion', 'rtma': 'Rathma', 'dcma': 'Diablo Clone', 'ubtm': 'Uber Tristram', 'uba': 'Uber Ancients'}


def load_bosses():
    """Map bosses by monster class (scripts/extract_monsters.py writes bosses.json)."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bosses.json')) as f:
            return {int(k): v for k, v in json.load(f).items()}
    except OSError:
        return {}


BOSSES = load_bosses()


def load_never_count():
    """Monster classes whose deaths are no kills (scripts/extract_monsters.py writes nevercount.json)."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'nevercount.json')) as f:
            return set(json.load(f))
    except OSError:
        return set()


# Monster-cast hydras, the players' own summons...: seen dying, but the game doesn't count them.
NEVER_COUNT = load_never_count()



class Bits:
    def __init__(self, data, start, end):
        self.d, self.pos, self.end = data, start * 8, end * 8

    def read(self, n):
        if self.pos + n > self.end:
            raise EOFError
        v = 0
        for k in range(n):
            p = self.pos + k
            v |= ((self.d[p >> 3] >> (p & 7)) & 1) << k
        self.pos += n
        return v


def parse_item(pkt):
    """Decode a 0x9C/0x9D item packet (whole packet) into a dict, or None."""
    if len(pkt) < 13:
        return None
    pid, action = pkt[0], pkt[1]
    o = 8 + (5 if pid == 0x9D else 0)
    if o + 5 > len(pkt):
        return None
    flags = struct.unpack_from('<I', pkt, o)[0]
    it = {'action': action, 'unit': struct.unpack_from('<I', pkt, 4)[0],
          'identified': bool(flags & F_IDENT), 'ethereal': bool(flags & F_ETH)}
    bits = Bits(pkt, o + 5, len(pkt))
    try:
        bits.read(2)
        if bits.read(3) == 3:  # on the ground: x/y
            it['pos'] = (bits.read(16), bits.read(16))
        else:
            bits.read(15)
        if flags & F_EAR:
            return None
        code = bytes(bits.read(8) for _ in range(4)).decode('latin1').strip()
        if not (3 <= len(code) <= 4 and code.isalnum()):
            return None
        it['code'] = code
        if code == 'gld':
            return it
        bits.read(3)
        if flags & (F_SIMPLE | F_GAMBLE):
            it['simple'] = True
            return it
        it['ilvl'] = bits.read(7)
        q = bits.read(4)
        it['quality'] = QUALITY[q] if q < len(QUALITY) else str(q)
        if bits.read(1):  # graphic variant: which ring/amulet/jewel/charm art
            it['graphic'] = bits.read(3)
        if flags & F_IDENT:
            info = {}
            uid, stats = items.read_body(bits, flags, code, q, info)
            if info.get('sockets'):
                it['sockets'] = info['sockets']
            if uid is not None:  # set / unique index, sent once identified
                it['uid'] = uid
            it['mods'] = items.describe(stats)
            if stats and any(s[0] == items.CORRUPTOR for s in stats):
                it['corrupting'] = True
    except EOFError:
        pass
    return it



def item_fields(it):
    return {k: it[k] for k in ('code', 'quality', 'ilvl', 'uid', 'ethereal', 'sockets', 'graphic') if k in it}


# ---------------------------------------------------------------- game session
CLASSES = ['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian', 'Druid', 'Assassin']


class Game:
    """One game connection: turns decoded packets into tracker events."""

    def __init__(self, emit, ts, server, client_port):
        self.emit = emit
        self.id = f'{int(ts * 1000)}-{client_port}'
        self.server = server
        self.started = False
        self.character = None
        self.char_class = None  # from the join packet
        self.level = None
        self.self_id = None     # first 0x59 with our name; PD2 later assigns the name to a second unit
        self.area = None
        self.tiles = {}         # area -> map tiles the client has loaded
        self.items = {}         # unit -> last decoded item (inventory, stash, ground)
        self.dropped = {}       # unit -> area it dropped in (this game only)
        self.ground = set()     # (code, x, y) of drops seen, in case an item is re-sent under a new unit
        self.picked = set()
        self.shop = {}          # unit -> item offered by a vendor this game
        self.bought = set()
        self.buying = None      # (shop unit, ts) of the last purchase, until its item arrives
        self.bought_as = {}     # unit -> shop unit it was bought as (gambling creates a new item)
        self.corrupting = None  # (item, ts) marked for corruption, until the corrupted item arrives
        self.transmuting = None  # (ts, [consumed items]) after the cube's Transmute, until its result arrives
        self.kills = None
        self.monsters = set()   # units assigned as NPCs (0xAC) whose deaths count as kills
        self.died = set()
        self.boss_units = {}    # unit -> boss name; a boss can be several units (hydra heads)
        self.uber_units = {}    # unit -> monster class of an uber boss
        self.uber_life = {}     # unit -> life, 0-128 (the game's scale)
        self.uber_active = None  # the encounter last seen, the lowest HP % of each of its bosses,
        self.uber_low = {}       # the furthest phase reached (Rathma) and what was last reported
        self.uber_phase = None
        self.uber_hp_sent = None
        self.uber_live_sent = (None, 0.0)  # current HP per boss last sent live, and when
        self.uber_died = {}     # unit -> area it died in
        self.ubers_killed = set()
        self.bosses_killed = set()
        self.kills_sent = (None, 0, 0.0)
        self.xp = None          # own experience: absolute on join (0x1C), then gains (0x1A/0x1B)
        self.xp_owed = 0        # lost to a death and not yet won back by picking up the corpse
        self.xp_lost = 0        # this game's death losses, net of what the corpse gave back
        self.xp_sent = None
        self.mendeln_units = set()
        self.event_units = set()  # monsters and objects already reported as a map event
        self.xp_deaths = [0, 0]  # monster deaths since the last XP gain: Mendeln's, all
        self.mendeln_xp = 0.0    # experience from Mendeln's units, not yet sent
        self.midstream = False  # joined mid-game: no join packets (character name, own unit)

    def event(self, ts, kind, **fields):
        self.emit({'type': kind, 'game': self.id, 'ts': round(ts * 1000), **fields})

    def start(self, ts):
        if not self.started:
            self.started = True
            self.event(ts, 'game_start', server=self.server, character=self.character, charClass=self.char_class)

    # ---- client -> server
    def on_client(self, ts, p):
        pid = p[0]
        if pid == 0x68 and len(p) > 22:
            m = re.match(rb'([A-Za-z0-9_\-]{2,16})\x00', p[21:])
            if m:
                self.character = m.group(1).decode()
                self.char_class = CLASSES[p[7]] if p[7] < len(CLASSES) else None
        elif pid == 0x4f and len(p) > 1 and p[1] == 0x18:  # the cube's Transmute button
            self.transmuting = (ts, [])
        elif pid == 0x32:  # buy from a vendor: npc, item, buffer, cost
            unit = struct.unpack_from('<I', p, 5)[0]
            if unit in self.shop and unit not in self.bought:
                self.bought.add(unit)
                self.buying = (unit, ts)
                self.event(ts, 'shop_buy', unit=unit, **item_fields(self.shop[unit]))
        elif pid == 0x20:  # use item (right click)
            it = self.items.get(struct.unpack_from('<I', p, 1)[0])
            if it and (MAP_CODE.match(it.get('code', '')) or it.get('code') in UBER_CODES):
                mods = [{'stat': m['name'], 'value': m['values'][0], 'label': m['label']} for m in it['mods']] if it.get('mods') is not None else None
                if MAP_CODE.match(it['code']):
                    self.event(ts, 'map_used', area=self.area, mods=mods, **item_fields(it))
                else:  # cubing cycles uber_difficulty: none (tier 0) -> 1 -> 2 -> none
                    tier = next((m['values'][0] for m in it.get('mods') or [] if m['name'] == 'uber_difficulty'), 0)
                    self.event(ts, 'uber_used', area=self.area, name=UBER_CODES[it['code']], tier=tier, mods=mods, **item_fields(it))

    # ---- server -> client
    def on_server(self, ts, p):
        pid = p[0]
        if pid in (0x07, 0x08):
            # The client only holds tiles around the player: once the current area has
            # none left and exactly one area is loaded, the player moved there (portal,
            # waypoint, town portal). Walking across a border is caught by 0x7F below.
            tiles = self.tiles.setdefault(p[5], set())
            (tiles.add if pid == 0x07 else tiles.discard)(p[1:5])
            loaded = [a for a, t in self.tiles.items() if t]
            if self.area not in loaded and len(loaded) == 1:
                self.set_area(ts, loaded[0])
        elif pid == 0x01 and len(p) >= 8:
            # Game flags on joining: difficulty, then a flags word (0x200000 = ladder), expansion, ladder.
            self.event(ts, 'game_flags', ladder=bool(p[7]))
        elif pid == 0x7f and struct.unpack_from('<I', p, 4)[0] == (self.self_id or 1):
            self.set_area(ts, struct.unpack_from('<H', p, 8)[0])
        elif pid == 0x59 and self.self_id is None and p[6:22].split(b'\0')[0].decode('latin1') == self.character:
            self.self_id = struct.unpack_from('<I', p, 1)[0]
        elif pid == 0x65 and self.midstream and self.self_id is None and struct.unpack_from('<H', p, 5)[0] != 0xFFFF:
            # Joined mid-game: the kill counter is only sent for the player's own unit (0xFFFF: no count yet).
            self.self_id = struct.unpack_from('<I', p, 1)[0]
            self.kills = struct.unpack_from('<H', p, 5)[0]
        elif pid == 0x65 and struct.unpack_from('<I', p, 1)[0] == (self.self_id or 1) and struct.unpack_from('<H', p, 5)[0] != 0xFFFF:
            self.kills = struct.unpack_from('<H', p, 5)[0]
            if ts - self.kills_sent[2] >= KILLS_EVERY:
                self.flush_kills(ts)
        elif pid == 0xac:
            unit, cls = struct.unpack_from('<IH', p, 1)
            if cls not in NEVER_COUNT:
                self.monsters.add(unit)
            if cls in MENDELN_CLASSES:
                self.mendeln_units.add(unit)
            kind = EVENT_MONSTERS.get(cls)
            if kind and unit not in self.event_units:
                self.event_units.add(unit)
                if kind[0].isupper():
                    self.event(ts, 'map_event', event='invaders', invader=kind)
                else:
                    self.event(ts, 'map_event', event=kind)
            if cls in UBER_BOSSES:
                self.uber_units[unit] = cls
                self.uber_life[unit] = p[11]
                self.start_encounter(UBER_BOSSES[cls])
                self.track_life(unit)
            name = BOSSES.get(cls)
            if name and unit not in self.boss_units:
                if name not in self.boss_units.values():
                    self.event(ts, 'boss', name=name, state='seen', area=self.area)
                self.boss_units[unit] = name
        elif pid == 0x51 and len(p) >= 8:  # object assigned: type, unit, class
            unit, cls = struct.unpack_from('<IH', p, 2)
            if cls in EVENT_OBJECTS and ('o', unit) not in self.event_units:
                self.event_units.add(('o', unit))
                self.event(ts, 'map_event', event=EVENT_OBJECTS[cls])
        elif pid == 0x69 and p[5] == 0x08:  # NPC dying - by anyone, as the game's .kills counts them
            unit = struct.unpack_from('<I', p, 1)[0]
            name = UBER_BOSSES.get(self.uber_units.get(unit))
            if name:
                self.uber_life[unit] = 0
                self.track_life(unit)
                self.uber_died.setdefault(unit, self.area)
                arena = UBER_ARENA.get(name)
                if arena:
                    died = {self.uber_units[u] for u, a in self.uber_died.items() if a == arena}
                    done = {c for c, n in UBER_BOSSES.items() if n == name} <= died
                else:
                    done = all(u in self.uber_died for u, c in self.uber_units.items() if UBER_BOSSES[c] == name)
                if name not in self.ubers_killed and done:
                    self.ubers_killed.add(name)
                    self.event(ts, 'uber_killed', area=self.area, name=name)
            if unit in self.monsters and unit not in self.died:
                self.died.add(unit)
                self.xp_deaths[0] += unit in self.mendeln_units
                self.xp_deaths[1] += 1
                name = self.boss_units.get(unit)
                if name and name not in self.bosses_killed and all(u in self.died for u, n in self.boss_units.items() if n == name):
                    self.bosses_killed.add(name)
                    self.flush_kills(ts)
                    self.event(ts, 'boss', name=name, state='killed', area=self.area)
                if ts - self.kills_sent[2] >= KILLS_EVERY:
                    self.flush_kills(ts)
        elif pid == 0x5a and p[1] == 0x06 and len(p) >= 24:
            # "<name> was slain by ...": sent for every player in the game. Unknown name
            # (joined mid-game) means the death can't be told apart from a party member's.
            if self.character and p[8:24].split(b'\0')[0].decode('latin1') == self.character:
                cls = struct.unpack_from('<I', p, 3)[0]  # monster class when p[7] == 1
                self.report_uber_hp(ts)
                self.event(ts, 'death', area=self.area, killer=cls if p[7] == 1 else None,
                           killerName=BOSSES.get(cls) if p[7] == 1 else p[24:40].split(b'\0')[0].decode('latin1') or None)
        elif pid == 0x0c and len(p) >= 9 and struct.unpack_from('<I', p, 2)[0] in self.uber_life:  # NPC hit
            self.uber_life[struct.unpack_from('<I', p, 2)[0]] = p[8]
            self.track_life(struct.unpack_from('<I', p, 2)[0])
        elif pid == 0x6d and len(p) >= 10 and struct.unpack_from('<I', p, 1)[0] in self.uber_life:  # NPC stop
            self.uber_life[struct.unpack_from('<I', p, 1)[0]] = p[9]
            self.track_life(struct.unpack_from('<I', p, 1)[0])
        elif pid == 0x1d and p[1] == 12:  # own level (on joining, then on each level up)
            if p[2] != self.level:
                self.level = p[2]
                self.event(ts, 'level', level=p[2])
        elif pid in (0x1a, 0x1b) and self.xp is not None:  # experience gained (byte / word)
            self.gain_xp(p[1] if pid == 0x1a else struct.unpack_from('<H', p, 1)[0])
        elif pid == 0x1c:
            # Experience set outright: on joining, on dying (the penalty), on picking up the corpse
            # (part of it back, once) and for gains too big for a word. The first rise after a
            # death is the corpse, up to what the death cost.
            # ponytail: a big gain (uber kill) between a death and the corpse counts as won back.
            xp = struct.unpack_from('<I', p, 1)[0]
            if self.xp is not None and xp < self.xp:
                self.xp_owed += self.xp - xp
                self.xp_lost += self.xp - xp
            elif self.xp is not None and self.xp_owed:
                self.xp_lost -= min(self.xp_owed, xp - self.xp)
                self.xp_owed = 0
            elif self.xp is not None:
                self.gain_xp(xp - self.xp)
            self.xp = xp
            if self.started:
                self.flush_xp(ts)
        elif pid == 0x26 and p[1] == 0x04:  # system notice, never player chat
            parts = p[10:].split(b'\0')
            if len(parts) > 1 and parts[1]:
                self.event(ts, 'notice', text=parts[1].decode('latin1'))
        elif pid == 0x60 and p[1] == 0:
            self.event(ts, 'portal', area=p[2], unit=struct.unpack_from('<I', p, 3)[0])
        elif pid in (0x9c, 0x9d):
            self.on_item(ts, p)

    def tick(self, ts):
        """Send kills that arrived within KILLS_EVERY of the last update once it has passed."""
        if self.started and ts - self.kills_sent[2] >= KILLS_EVERY:
            self.flush_kills(ts)
        if self.started:
            self.report_uber_live(ts)

    def report_uber_live(self, ts):
        """Each boss's HP now (its newest unit), for the live boss timer: at most every KILLS_EVERY."""
        if not self.uber_active or ts - self.uber_live_sent[1] < KILLS_EVERY:
            return
        newest = {}
        for unit, cls in self.uber_units.items():
            if UBER_BOSSES[cls] == self.uber_active:
                name = UBER_NAMES.get(cls, UBER_BOSSES[cls])
                newest[name] = max(newest.get(name, unit), unit)
        bosses = {name: round(self.uber_life[u] / 128 * 100) for name, u in newest.items()}
        if bosses and bosses != self.uber_live_sent[0]:
            self.uber_live_sent = (bosses, ts)
            self.event(ts, 'uber_live', name=self.uber_active, bosses=bosses)

    def flush_kills(self, ts):
        if (self.kills, len(self.died)) != self.kills_sent[:2]:
            # count: the game's kill counter for the player; deaths: monsters seen dying
            self.event(ts, 'kills', count=self.kills, deaths=len(self.died))
            self.kills_sent = (self.kills, len(self.died), ts)
        self.flush_xp(ts)

    def gain_xp(self, n):
        """A gain is for the monsters that died since the last one; Mendeln's units get their share."""
        # ponytail: split by count when his undead die in one batch with map monsters (worth less each).
        mendeln, total = self.xp_deaths
        if total:
            self.mendeln_xp += n * mendeln / total
        self.xp_deaths = [0, 0]
        self.xp += n

    def flush_xp(self, ts):
        if self.mendeln_xp >= 1:
            self.event(ts, 'mendeln_xp', xp=round(self.mendeln_xp), total=self.xp)
            self.mendeln_xp = 0.0
        if self.xp is not None and (self.xp, self.xp_lost) != self.xp_sent:
            self.event(ts, 'xp', xp=self.xp, lost=self.xp_lost)
            self.xp_sent = (self.xp, self.xp_lost)

    def start_encounter(self, name):
        if self.uber_active != name:
            self.uber_active, self.uber_low, self.uber_phase = name, {}, None
            self.uber_live_sent = (None, 0.0)

    def track_life(self, unit):
        """Each boss's lowest HP (%) in the encounter; only in its last arena for a fight in phases."""
        cls = self.uber_units[unit]
        arena = UBER_ARENA.get(UBER_BOSSES[cls])
        if UBER_BOSSES[cls] == self.uber_active and (arena is None or self.area == arena):
            name = UBER_NAMES.get(cls, UBER_BOSSES[cls])
            self.uber_low[name] = min(self.uber_low.get(name, 100), round(self.uber_life[unit] / 128 * 100))

    def report_uber_hp(self, ts):
        """How far the fight got: on dying, leaving its area and the game ending. hp: its bosses' average."""
        if not self.uber_active:
            return
        bosses = dict(self.uber_low)
        hp = round(sum(bosses.values()) / len(bosses)) if bosses else None
        sent = (hp, bosses, self.uber_phase)
        if sent != self.uber_hp_sent and (bosses or self.uber_phase):
            self.uber_hp_sent = sent
            self.event(ts, 'uber_hp', name=self.uber_active, hp=hp, bosses=bosses, phase=self.uber_phase)

    def set_area(self, ts, area):
        if area == self.area or area == 0:
            return
        self.report_uber_hp(ts)
        if area in RATHMA_PHASES:  # the phase reached, 1-3
            self.start_encounter('Rathma')
            self.uber_phase = max(self.uber_phase or 0, RATHMA_PHASES.index(area) + 1)
        self.flush_kills(ts)
        self.area = area
        self.event(ts, 'area', area=area)

    def on_item(self, ts, p):
        it = parse_item(p)
        if not it or 'code' not in it:
            return
        unit, action, code = it['unit'], it['action'], it['code']
        prev = self.items.get(unit)
        self.items[unit] = it
        it['area'] = self.area  # where the player was: for an item put on the ground, where it lies
        if it.get('corrupting') and not any(m['name'] == 'corrupted' for m in it.get('mods') or []):
            self.corrupting = (prev if prev and prev.get('mods') is not None else it, ts)
        elif (self.corrupting and prev is None and ts - self.corrupting[1] < 10 and it.get('mods')
              and any(m['name'] == 'corrupted' for m in it['mods']) and not MAP_CODE.match(code)):
            # Corrupting (cube) replaces the item with a new unit: its new properties.
            before = self.corrupting[0]
            self.event(ts, 'corrupted', before={**item_fields(before), 'mods': before['mods']}, mods=it['mods'], **item_fields(it))
            self.corrupting = None
        if self.transmuting and ts - self.transmuting[0] < 3:
            if p[0] == 0x9d and action == ACT_REMOVE and prev:
                self.transmuting[1].append(prev)  # consumed by the recipe
            elif (action == ACT_TO_CONTAINER and prev is None and it.get('quality') == 'crafted'
                  and not any(m['name'] == 'corrupted' for m in it.get('mods') or [])):
                # A crafting recipe's result: a new crafted item in the cube. (A corruption's
                # result is the 'corrupted' event above.)
                inputs = [{'code': x['code'], 'quality': x.get('quality')} for x in self.transmuting[1]]
                self.event(ts, 'crafted', area=self.area, inputs=inputs, mods=it.get('mods'), **item_fields(it))
                self.transmuting = None
        if action == ACT_TO_CONTAINER and prev is None and self.buying and ts - self.buying[1] < 3:
            # The purchase lands as a new unit (a gamble rolls a new item, maybe on a better base).
            self.bought_as[unit] = self.buying[0]
            self.buying = None
        if action == ACT_ADD_TO_SHOP and unit not in self.shop:
            # Vendor stock (sent when a shop opens) - Gheed's offer during his map event.
            self.shop[unit] = it
            self.event(ts, 'shop_item', unit=unit, **item_fields(it))
        if p[0] == 0x9c and action == ACT_ADD_TO_GROUND:
            spot = (code, *it.get('pos', (unit, 0)))
            if code not in JUNK and unit not in self.dropped and spot not in self.ground:
                self.event(ts, 'drop', **item_fields(it))
            self.dropped.setdefault(unit, self.area)
            self.ground.add(spot)
        elif action in PICKUP_ACTIONS and unit in self.dropped and unit not in self.picked:
            self.picked.add(unit)
            if code not in JUNK:
                self.event(ts, 'pickup', unit=unit, area=self.dropped[unit], identified=it['identified'], mods=it.get('mods'), **item_fields(it))
        if it['identified'] and prev and not prev['identified'] and 'quality' in it:
            shop_unit = self.bought_as.get(unit, unit)
            extra = {'bought': True} if shop_unit in self.bought else {}
            self.event(ts, 'identified', unit=shop_unit, area=self.dropped.get(unit), droppedHere=unit in self.dropped, mods=it.get('mods'), **extra, **item_fields(it))

    def end(self, ts):
        if self.started:
            self.flush_kills(ts)
            self.report_uber_hp(ts)
            # Picked up, then left on the ground when the game ended: not kept after all.
            for unit in sorted(self.picked):
                it = self.items[unit]
                if it['action'] in ON_GROUND_ACTIONS and it['code'] not in JUNK:
                    self.event(ts, 'discarded', unit=unit, area=it['area'], **item_fields(it))
            self.event(ts, 'game_end')
            self.started = False


# ---------------------------------------------------------------- tcp
# A gap in a stream (a segment the capture dropped) is skipped after this many seconds;
# retransmissions of segments the game itself lost arrive well within it.
GAP_WAIT = 1.0


class Stream:
    """In-order byte stream of one TCP direction."""

    def __init__(self):
        self.next = None
        self.pending = {}
        self.data = bytearray()
        self.seen = 0
        self.gap_since = None
        # After a skipped gap the data continues mid-chunk: `starts` collects where TCP
        # segments begin (as `seen` offsets) to look for the next chunk there.
        self.resync = False
        self.starts = []

    def segment(self, seq, syn, payload, ts=0.0):
        if syn:
            self.next = (seq + 1) & 0xFFFFFFFF
            return False
        if not payload:
            return False
        if self.next is None:
            self.next = seq
        self.pending.setdefault(seq, payload)
        grew = self._drain()
        if not self.pending:
            self.gap_since = None
        elif self.gap_since is None:
            self.gap_since = ts
        elif ts - self.gap_since > GAP_WAIT or len(self.pending) > 5000:
            # The missing bytes won't come: continue after them and resync on a chunk.
            self.next = min(self.pending, key=lambda s: (s - self.next) & 0xFFFFFFFF)
            self.data.clear()
            self.resync, self.starts = True, []
            grew = self._drain() or grew
            self.gap_since = ts if self.pending else None
        return grew

    def _drain(self):
        grew = False
        progressed = True
        while progressed:
            progressed = False
            for s in list(self.pending):
                p = self.pending[s]
                ahead = (s - self.next) & 0xFFFFFFFF
                if ahead >= 0x80000000:  # starts before `next`: keep only the unseen tail
                    behind = 0x100000000 - ahead
                    del self.pending[s]
                    if behind < len(p):
                        self._take(p[behind:])
                        progressed = grew = True
                elif ahead == 0:
                    del self.pending[s]
                    self._take(p)
                    progressed = grew = True
        return grew

    def _take(self, p):
        if self.resync:
            self.starts.append(self.seen)
        self.data += p
        self.seen += len(p)
        self.next = (self.next + len(p)) & 0xFFFFFFFF


def redact_client(frame, payload):
    """
    A copy of a client->server frame with no login secrets, for recordings: the PD2 auth blob
    (0x56) is blanked and the game join (0x68) keeps only the class and character name (bytes 7
    and 21+, all the replay reads), not the game's hash, token and the rest. A client segment
    starts with a packet; an unknown one stops the walk.
    """
    out, o = bytearray(payload), 0
    while o < len(out):
        pid = out[o]
        if pid == 0x68:
            n = 37
            out[o + 1:o + 7] = bytes(len(out[o + 1:o + 7]))
            out[o + 8:o + 21] = bytes(len(out[o + 8:o + 21]))
        elif pid == 0x56:
            end = out.find(0, o + 1)
            stop = end if end >= 0 else len(out)
            out[o + 1:stop] = b'0' * (stop - o - 1)
            n = stop + 1 - o
        else:
            n = C2S.get(pid)
            if not n:
                break
        o += n
    if out == payload:
        return frame
    at = len(frame) - len(payload) if frame.endswith(payload) else frame.rfind(payload)
    return frame[:at] + bytes(out) + frame[at + len(payload):]


def scrub_recordings(directory):
    """Blank login secrets in recordings written before redact_client existed (rewritten only when changed)."""
    for name in sorted(os.listdir(directory)) if os.path.isdir(directory) else []:
        path = os.path.join(directory, name)
        if not name.endswith('.pcap'):
            continue
        try:
            with open(path, 'rb') as f:
                data = bytearray(f.read())
            if len(data) < 24 or struct.unpack_from('<I', data, 20)[0] != 101:
                continue  # only the raw-IP files record() writes
            o, changed = 24, False
            while o + 16 <= len(data):
                incl = struct.unpack_from('<I', data, o + 8)[0]
                pkt = bytes(data[o + 16:o + 16 + incl])
                ihl = (pkt[0] & 0x0F) * 4 if pkt and pkt[0] >> 4 == 4 else 40
                if len(pkt) > ihl + 20 and struct.unpack_from('>H', pkt, ihl + 2)[0] == GAME_PORT:
                    tcp = pkt[ihl:]
                    payload = tcp[(tcp[12] >> 4) * 4:]
                    clean = redact_client(pkt, payload) if payload else pkt
                    if clean != pkt:
                        data[o + 16:o + 16 + incl] = clean
                        changed = True
                o += 16 + incl
            if changed:
                with open(path + '.tmp', 'wb') as f:
                    f.write(data)
                os.replace(path + '.tmp', path)
        except (OSError, struct.error, IndexError) as e:
            print(f'scrubbing {name} failed: {e}', file=sys.stderr)


class Conn:
    def __init__(self, client, server):
        self.client, self.server = client, server
        self.up, self.down = Stream(), Stream()
        self.game = None       # Game once the stream proved to be a D2 game connection
        self.rejected = False
        self.last = 0.0
        self.frames = []       # raw frames kept until the connection is classified (for recording)
        self.recording = None
        self.midstream = False  # picked up after its handshake (capture started mid-game)


# Kill counters are sent at most this often (seconds) - often enough for a live counter.
KILLS_EVERY = 1


class Tracker:
    def __init__(self, emit, record_dir=None, keep=40):
        self.emit = emit
        self.conns = {}
        self.record_dir = record_dir
        self.keep = keep
        if record_dir:
            scrub_recordings(record_dir)

    def record(self, c, ts, frame):
        if not self.record_dir or c.rejected:
            return
        if c.game is None:
            if len(c.frames) < 5000:
                c.frames.append((ts, frame))
            return
        if c.recording is None:
            os.makedirs(self.record_dir, exist_ok=True)
            files = sorted(f for f in os.listdir(self.record_dir) if f.endswith('.pcap'))
            for old in files[:max(0, len(files) - self.keep + 1)]:
                os.remove(os.path.join(self.record_dir, old))
            # Unbuffered: a game in progress can be read (replayed) while it's still being recorded.
            c.recording = open(os.path.join(self.record_dir, f'{c.game.id}.pcap'), 'wb', buffering=0)
            c.recording.write(struct.pack('<IHHiIII', 0xA1B2C3D4, 2, 4, 0, 0, 65535, 101))
        for t, f in c.frames + [(ts, frame)]:
            sec = int(t)
            c.recording.write(struct.pack('<IIII', sec, int((t - sec) * 1e6), len(f), len(f)) + f)
        c.frames = []

    def tick(self, ts):
        for c in self.conns.values():
            if c.game: c.game.tick(ts)

    def close(self, c):
        if c.recording:
            c.recording.close()
            c.recording = None

    def on_tcp(self, ts, src, dst, seq, flags, payload, frame=b''):
        key = (src, dst) if (src, dst) in self.conns else (dst, src)
        c = self.conns.get(key)
        if c is None:
            if flags & 0x02 and not flags & 0x10:
                c = self.conns[(src, dst)] = Conn(src, dst)
            elif GAME_PORT in (src[1], dst[1]) and payload and not flags & 0x05:
                # A game already running (capture restarted mid-game): decode from the next chunk.
                server, client = (src, dst) if src[1] == GAME_PORT else (dst, src)
                c = self.conns[(client, server)] = Conn(client, server)
                c.midstream = True
                c.down.resync = True
            else:
                return
        c.last = ts
        if c.rejected:
            c.frames = []
            if flags & 0x05: del self.conns[key]
            return
        upstream = src == c.client
        # Recordings never keep the client's login secrets (see redact_client).
        self.record(c, ts, redact_client(frame, payload) if upstream and payload else frame)
        st = c.up if upstream else c.down
        if st.segment(seq, flags & 0x02, payload, ts):
            try:
                self.pump(ts, c, upstream)
            except Exception as e:  # a decode bug must not kill capture
                print(f'decode error: {e!r}', file=sys.stderr, flush=True)
                (c.up if upstream else c.down).data.clear()
        if flags & 0x05:  # FIN / RST
            if c.game: c.game.end(ts)
            self.close(c)
            del self.conns[key]

    def pump(self, ts, c, upstream):
        if c.game is None and c.midstream:
            if upstream:
                c.up.data.clear()  # the client side is only read once the game is known
                return
            if not resync(c.down):
                if c.down.seen > 256 * 1024: c.rejected = True  # not a game stream after all
                return
            c.game = Game(self.emit, ts, f'{c.server[0]}:{c.server[1]}', c.client[1])
            c.game.midstream = True
            self.server_packets(ts, c)
            return
        if c.game is None:
            d = c.down.data
            if len(d) < 2:
                if c.down.seen == 0 and c.up.seen > 4096: c.rejected = True
                return
            if d[:2] != b'\xaf\x01':
                c.rejected = True
                return
            del d[:2]
            c.game = Game(self.emit, ts, f'{c.server[0]}:{c.server[1]}', c.client[1])
            upstream = True  # parse the join packet first (character name)
            self.client_packets(ts, c)
            self.server_packets(ts, c)
            return
        if upstream:
            self.client_packets(ts, c)
        else:
            self.server_packets(ts, c)

    def client_packets(self, ts, c):
        buf = c.up.data
        c.up.resync = False  # client packets aren't chunked: a segment start is a packet start
        while buf:
            pid = buf[0]
            if pid == 0x68:
                n = 37 if len(buf) >= 37 else None
            elif pid == 0x56:  # PD2 auth blob: hex string, NUL terminated
                end = buf.find(0, 1)
                n = end + 1 if end >= 0 else None
            else:
                n = C2S.get(pid)
                if n is None:
                    buf.clear()  # unknown: resync at the next segment
                    return
            if n is None or len(buf) < n:
                return
            c.game.on_client(ts, bytes(buf[:n]))
            del buf[:n]

    def server_packets(self, ts, c):
        buf = c.down.data
        g = c.game
        if c.down.resync and not resync(c.down):
            return
        while True:
            cs = chunk_size(buf)
            if cs is None or len(buf) < cs[1]:
                return
            hdr, size = cs
            if size <= hdr:  # lost framing: nothing sane can follow
                buf.clear()
                return
            out = decompress(bytes(buf[:size]), hdr)
            del buf[:size]
            o = 0
            while o < len(out):
                n = s2c_size(out, o)
                if not n or o + n > len(out):
                    break  # unknown packet: skip the rest of this chunk
                g.on_server(ts, out[o:o + n])
                if not g.started and (g.midstream or out[o] in (0x01, 0x03)):
                    g.start(ts)
                o += n

    def expire(self, now, idle=120):
        for key, c in list(self.conns.items()):
            if now - c.last > idle:
                if c.game: c.game.end(c.last)
                self.close(c)
                del self.conns[key]


# ---------------------------------------------------------------- ip / capture
def on_ip(tracker, ts, pkt):
    if not pkt:
        return
    ver = pkt[0] >> 4
    if ver == 4 and len(pkt) >= 20 and pkt[9] == 6:
        ihl = (pkt[0] & 0x0F) * 4
        tot = struct.unpack_from('>H', pkt, 2)[0]
        if tot >= 20:  # 0 on Windows for outgoing segments under large-send offload: keep what we got
            pkt = pkt[:tot]
        src, dst, tcp = socket.inet_ntoa(pkt[12:16]), socket.inet_ntoa(pkt[16:20]), pkt[ihl:]
    elif ver == 6 and len(pkt) >= 40 and pkt[6] == 6:
        plen = struct.unpack_from('>H', pkt, 4)[0]
        src = socket.inet_ntop(socket.AF_INET6, pkt[8:24])
        dst = socket.inet_ntop(socket.AF_INET6, pkt[24:40])
        tcp = pkt[40:40 + plen]
    else:
        return
    if len(tcp) < 20:
        return
    sport, dport, seq = struct.unpack_from('>HHI', tcp, 0)
    tracker.on_tcp(ts, (src, sport), (dst, dport), seq, tcp[13], bytes(tcp[(tcp[12] >> 4) * 4:]), pkt)


def link_to_ip(linktype, frame):
    if linktype in (101, 228, 229):
        return frame
    if linktype == 1:
        et, off = struct.unpack_from('>H', frame, 12)[0], 14
        while et == 0x8100:
            et, off = struct.unpack_from('>H', frame, off + 2)[0], off + 4
        return frame[off:] if et in (0x0800, 0x86DD) else None
    if linktype == 113:
        return frame[16:] if struct.unpack_from('>H', frame, 14)[0] in (0x0800, 0x86DD) else None
    if linktype == 276:
        return frame[20:] if struct.unpack_from('>H', frame, 0)[0] in (0x0800, 0x86DD) else None
    return None


def replay(path, tracker):
    with open(path, 'rb') as f:
        gh = f.read(24)
        magic = gh[:4]
        if magic in (b'\xd4\xc3\xb2\xa1', b'\x4d\x3c\xb2\xa1'):
            e = '<'
        elif magic in (b'\xa1\xb2\xc3\xd4', b'\xa1\xb2\x3c\x4d'):
            e = '>'
        else:
            sys.exit('not a classic pcap file')
        nano = magic in (b'\x4d\x3c\xb2\xa1', b'\xa1\xb2\x3c\x4d')
        linktype = struct.unpack(e + 'I', gh[20:24])[0]
        ts = 0
        while True:
            rh = f.read(16)
            if len(rh) < 16:
                break
            sec, frac, incl, _ = struct.unpack(e + 'IIII', rh)
            frame = f.read(incl)
            ts = sec + frac / (1e9 if nano else 1e6)
            ip = link_to_ip(linktype, frame)
            if ip is not None:
                on_ip(tracker, ts, ip)
        tracker.expire(ts + 1e9)


SKIP_IFACES = ('lo', 'docker', 'veth', 'br-', 'virbr')


def default_ip():
    """Local address of the adapter that routes to the internet (connect() sends nothing)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('1.1.1.1', 53))
        return s.getsockname()[0]
    finally:
        s.close()


def port_filter(port):
    """Classic BPF program for a packet socket whose data starts at the IP header: keeps
    TCP with `port` on either side (IPv4 or IPv6), drops everything else in the kernel."""
    drop, keep = 19, 20
    prog = [
        (0x30, None, None, 0), (0x54, None, None, 0xF0),  # A = IP version nibble
        (0x15, 3, 12, 0x40),
        (0x30, None, None, 9), (0x15, 5, drop, 6),        # IPv4: protocol TCP,
        (0x28, None, None, 6), (0x45, drop, 7, 0x1FFF),   # not a later fragment,
        (0xB1, None, None, 0),                            # X = header length
        (0x48, None, None, 0), (0x15, keep, 10, port),
        (0x48, None, None, 2), (0x15, keep, drop, port),
        (0x15, 13, drop, 0x60),
        (0x30, None, None, 6), (0x15, 15, drop, 6),       # IPv6: next header TCP
        (0x28, None, None, 40), (0x15, keep, 17, port),
        (0x28, None, None, 42), (0x15, keep, drop, port),
        (0x06, None, None, 0), (0x06, None, None, 0x40000),
    ]
    # Jump targets above are instruction indexes; BPF wants them relative to the next one.
    return b''.join(struct.pack('HBBI', code, (jt or i + 1) - i - 1, (jf or i + 1) - i - 1, k)
                    for i, (code, jt, jf, k) in enumerate(prog))


def attach_filter(s, prog):
    buf = ctypes.create_string_buffer(prog)
    s.setsockopt(socket.SOL_SOCKET, 26, struct.pack('HP', len(prog) // 8, ctypes.addressof(buf)))  # SO_ATTACH_FILTER


def open_capture(bind):
    """Returns (socket, recv) where recv() yields one IP packet, or None to skip it."""
    if hasattr(socket, 'AF_PACKET'):
        s = socket.socket(socket.AF_PACKET, socket.SOCK_DGRAM, socket.htons(0x0003))
        # Only game traffic leaves the kernel: a download next to the game costs nothing here.
        attach_filter(s, port_filter(GAME_PORT))
        # The game sends tens of KB at once when a game starts; the default buffer (~200 KB)
        # can overflow and drop a segment.
        s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)

        def recv():
            frame, addr = s.recvfrom(65535)
            if addr[0].startswith(SKIP_IFACES) or addr[1] not in (0x0800, 0x86DD):
                return None
            return frame
    else:
        # Windows: raw IP socket in promiscuous-receive mode (SIO_RCVALL) sees both
        # directions of every IPv4 packet on one adapter. Needs Administrator.
        ip = bind or default_ip()
        s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_IP)
        s.bind((ip, 0))
        s.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)
        s.ioctl(socket.SIO_RCVALL, socket.RCVALL_ON)
        print(f'listening on {ip}', flush=True)

        def recv():
            return s.recvfrom(65535)[0]
    s.settimeout(1.0)
    return s, recv


def live(tracker, record, bind=None, stop_requested=None):
    s, recv = open_capture(bind)
    w = open(record, 'ab') if record else None
    if w and w.tell() == 0:
        w.write(struct.pack('<IHHiIII', 0xA1B2C3D4, 2, 4, 0, 0, 65535, 101))
    stop = []
    signal.signal(signal.SIGTERM, lambda *_: stop.append(1))
    print('capturing game traffic', flush=True)
    # Frames are read on their own thread so decoding never holds up the socket.
    frames = queue.Queue()

    def reader():
        while not stop:
            try:
                frame = recv()
            except socket.timeout:
                continue
            except OSError:
                break
            if frame and not ((frame[0] >> 4 == 4 and frame[9] != 6) or (frame[0] >> 4 == 6 and frame[6] != 6)):
                frames.put((time.time(), frame))

    threading.Thread(target=reader, daemon=True).start()
    last_expire = last_check = time.time()
    try:
        while not stop:
            if time.time() - last_expire > 10:
                tracker.expire(time.time())
                last_expire = time.time()
            if stop_requested and time.time() - last_check > 1:
                last_check = time.time()
                if stop_requested():
                    stop.append(1)
                    break
            tracker.tick(time.time())
            try:
                now, frame = frames.get(timeout=1.0)
            except queue.Empty:
                continue
            if w:
                sec = int(now)
                w.write(struct.pack('<IIII', sec, int((now - sec) * 1e6), len(frame), len(frame)) + frame)
            on_ip(tracker, now, frame)
    except KeyboardInterrupt:
        pass
    finally:
        tracker.expire(float('inf'))
        if w:
            w.close()
        if hasattr(socket, 'RCVALL_OFF'):
            s.ioctl(socket.SIO_RCVALL, socket.RCVALL_OFF)
        s.close()


# ---------------------------------------------------------------- output
class Poster:
    """Batches events and POSTs them to the server, retrying while it is unreachable."""

    def __init__(self, url):
        self.url = url
        self.q = queue.Queue()
        self.pending = []
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def __call__(self, ev):
        self.q.put(ev)

    def run(self):
        backoff = 1
        while True:
            try:
                self.pending.append(self.q.get(timeout=1))
                while len(self.pending) < 500:
                    self.pending.append(self.q.get_nowait())
            except queue.Empty:
                pass
            if not self.pending:
                continue
            try:
                body = json.dumps({'events': self.pending}).encode()
                req = urllib.request.Request(self.url, body, {'content-type': 'application/json'})
                urllib.request.urlopen(req, timeout=10).read()
                self.pending = []
                backoff = 1
            except Exception as e:
                print(f'post failed ({e}); {len(self.pending)} event(s) queued', file=sys.stderr, flush=True)
                self.pending = self.pending[-50000:]
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)

    def drain(self, timeout=30):
        end = time.time() + timeout
        while (self.pending or not self.q.empty()) and time.time() < end:
            time.sleep(0.2)


def main():
    args = sys.argv[1:]
    opt = lambda name: args[args.index(name) + 1] if name in args else None
    if not args or args[0] not in ('live', 'replay'):
        sys.exit(__doc__)
    url = opt('--post')
    control = opt('--control-dir')
    stop_requested = None
    if control:
        with open(os.path.join(control, 'run.json')) as f:
            url = f'http://127.0.0.1:{int(json.load(f)["port"])}/api/capture/events'
        stop_file = os.path.join(control, 'stop')
        stop_requested = lambda: os.path.exists(stop_file)
    emit = Poster(url) if url else (lambda ev: print(json.dumps(ev), flush=True))
    tracker = Tracker(emit, record_dir=opt('--record-dir'))
    if args[0] == 'replay':
        replay(args[1], tracker)
    else:
        live(tracker, opt('--record'), opt('--bind'), stop_requested)
    if url:
        emit.drain()


if __name__ == '__main__':
    main()
