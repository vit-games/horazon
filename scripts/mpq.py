"""Minimal reader for Diablo II MPQ archives (format v1): the hash/block tables, file
encryption and the compressions D2-era archives use (PKWARE DCL "implode", zlib, bzip2).
Used by extract_monsters.py to read PD2's data tables from the local game install."""
import bz2
import struct
import zlib


def _crypt_table():
    seed, table = 0x00100001, [0] * 0x500
    for i in range(0x100):
        for k in range(5):
            seed = (seed * 125 + 3) % 0x2AAAAB
            hi = (seed & 0xFFFF) << 16
            seed = (seed * 125 + 3) % 0x2AAAAB
            table[i + k * 0x100] = hi | (seed & 0xFFFF)
    return table


CRYPT = _crypt_table()


def hash_string(s, kind):
    s1, s2 = 0x7FED7FED, 0xEEEEEEEE
    for ch in s.upper().replace('/', '\\'):
        c = ord(ch)
        s1 = CRYPT[(kind << 8) + c] ^ ((s1 + s2) & 0xFFFFFFFF)
        s2 = (c + s1 + s2 + (s2 << 5) + 3) & 0xFFFFFFFF
    return s1


def decrypt(data, key):
    out, s2, n = bytearray(data), 0xEEEEEEEE, len(data) // 4
    for i in range(n):
        s2 = (s2 + CRYPT[0x400 + (key & 0xFF)]) & 0xFFFFFFFF
        v = struct.unpack_from('<I', data, i * 4)[0] ^ ((key + s2) & 0xFFFFFFFF)
        key = (((~key << 0x15) + 0x11111111) & 0xFFFFFFFF) | (key >> 0x0B)
        s2 = (v + s2 + (s2 << 5) + 3) & 0xFFFFFFFF
        struct.pack_into('<I', out, i * 4, v)
    return bytes(out)


F_IMPLODE, F_COMPRESS, F_ENCRYPTED, F_FIX_KEY, F_SINGLE = 0x100, 0x200, 0x10000, 0x20000, 0x1000000


class MPQ:
    def __init__(self, path):
        self.f = open(path, 'rb')
        base = 0
        while True:  # the header sits at a 512-byte boundary
            self.f.seek(base)
            head = self.f.read(32)
            if head[:4] == b'MPQ\x1a':
                break
            if len(head) < 32:
                raise ValueError(f'{path}: no MPQ header')
            base += 512
        _, _, _, _, shift, htab, btab, hcount, bcount = struct.unpack('<4sIIHHIIII', head)
        self.base, self.sector = base, 512 << shift
        self.f.seek(base + htab)
        h = decrypt(self.f.read(hcount * 16), hash_string('(hash table)', 3))
        self.f.seek(base + btab)
        b = decrypt(self.f.read(bcount * 16), hash_string('(block table)', 3))
        self.hashes = [struct.unpack_from('<IIHHI', h, i * 16) for i in range(hcount)]
        self.blocks = [struct.unpack_from('<IIII', b, i * 16) for i in range(bcount)]

    def _block(self, name):
        n = len(self.hashes)
        i, a, b = hash_string(name, 0) % n, hash_string(name, 1), hash_string(name, 2)
        for _ in range(n):
            ha, hb, _, _, block = self.hashes[i]
            if block == 0xFFFFFFFF:
                return None
            if ha == a and hb == b and block != 0xFFFFFFFE:
                return self.blocks[block]
            i = (i + 1) % n
        return None

    def read(self, name):
        """The file's bytes, or None if the archive doesn't have it."""
        block = self._block(name)
        if block is None:
            return None
        offset, csize, size, flags = block
        self.f.seek(self.base + offset)
        raw = self.f.read(csize)
        key = 0
        if flags & F_ENCRYPTED:
            key = hash_string(name.replace('/', '\\').split('\\')[-1], 3)
            if flags & F_FIX_KEY:
                key = ((key + offset) ^ size) & 0xFFFFFFFF
        if flags & F_SINGLE:
            return _decompress(decrypt(raw, key) if flags & F_ENCRYPTED else raw, size, flags)
        count = (size + self.sector - 1) // self.sector
        if flags & (F_IMPLODE | F_COMPRESS):
            table = raw[:(count + 1) * 4]
            if flags & F_ENCRYPTED:
                table = decrypt(table, (key - 1) & 0xFFFFFFFF)
            offsets = struct.unpack(f'<{count + 1}I', table)
        else:
            offsets = [min(i * self.sector, size) for i in range(count + 1)]
        out = bytearray()
        for i in range(count):
            sector = raw[offsets[i]:offsets[i + 1]]
            if flags & F_ENCRYPTED:
                sector = decrypt(sector, (key + i) & 0xFFFFFFFF)
            out += _decompress(sector, min(self.sector, size - i * self.sector), flags)
        return bytes(out)


def _decompress(data, size, flags):
    if len(data) == size:  # stored as is
        return data
    if flags & F_IMPLODE:
        return explode(data)
    if flags & F_COMPRESS:
        mask, data = data[0], data[1:]
        if mask & ~0x1A:
            raise NotImplementedError(f'MPQ compression {mask:#x}')
        if mask & 0x10:
            data = bz2.decompress(data)
        if mask & 0x08:
            data = explode(data)
        if mask & 0x02:
            data = zlib.decompress(data)
    return data


# ---- PKWARE Data Compression Library "explode" (after Mark Adler's blast.c)
_MAXBITS = 13
_LITLEN = bytes([
    11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24, 12,
    11, 7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12, 8, 12, 5, 38,
    5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44, 253, 253, 253, 252, 252, 252, 13, 12, 45, 12, 45, 12,
    61, 12, 45, 44, 173])
_LENLEN = bytes([2, 35, 36, 53, 38, 23])
_DISTLEN = bytes([2, 20, 53, 230, 247, 151, 248])
_BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264]
_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]


def _huffman(rep):
    """Canonical code from blast.c's compact table: (count per length, symbols by code)."""
    lengths = []
    for b in rep:
        lengths += [b & 15] * ((b >> 4) + 1)
    count = [0] * (_MAXBITS + 1)
    for n in lengths:
        count[n] += 1
    offs = [0] * (_MAXBITS + 2)
    for n in range(1, _MAXBITS + 1):
        offs[n + 1] = offs[n] + count[n]
    symbol = [0] * len(lengths)
    for s, n in enumerate(lengths):
        if n:
            symbol[offs[n]] = s
            offs[n] += 1
    return count, symbol


_LIT, _LEN, _DIST = _huffman(_LITLEN), _huffman(_LENLEN), _huffman(_DISTLEN)


def explode(data):
    pos, bitbuf, bitcnt = 0, 0, 0

    def bits(n):
        nonlocal pos, bitbuf, bitcnt
        while bitcnt < n:
            if pos >= len(data):
                raise ValueError('explode: input ended')
            bitbuf |= data[pos] << bitcnt
            pos += 1
            bitcnt += 8
        v = bitbuf & ((1 << n) - 1)
        bitbuf >>= n
        bitcnt -= n
        return v

    def decode(table):
        count, symbol = table
        code = first = index = 0
        for n in range(1, _MAXBITS + 1):
            code |= bits(1) ^ 1  # PKWARE stores the codes inverted
            c = count[n]
            if code < first + c:
                return symbol[index + code - first]
            index += c
            first = (first + c) << 1
            code <<= 1
        raise ValueError('explode: bad code')

    coded, dict_bits = bits(8), bits(8)
    if coded > 1 or not 4 <= dict_bits <= 6:
        raise ValueError('explode: bad header')
    out = bytearray()
    while True:
        if bits(1):
            sym = decode(_LEN)
            length = _BASE[sym] + bits(_EXTRA[sym])
            if length == 519:  # end of stream
                return bytes(out)
            shift = 2 if length == 2 else dict_bits
            dist = (decode(_DIST) << shift) + bits(shift) + 1
            if dist > len(out):
                raise ValueError('explode: distance too far back')
            for _ in range(length):
                out.append(out[-dist])
        else:
            out.append(decode(_LIT) if coded else bits(8))
