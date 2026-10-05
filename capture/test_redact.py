"""Recordings keep no login secrets, from a hand-built client segment: python3 test_redact.py"""
import pd2capture as pc

join = bytes([0x68]) + b'\x11' * 6 + bytes([3]) + b'\x22' * 13 + b'Vitsin'.ljust(16, b'\0')
auth = bytes([0x56]) + b'deadbeef' * 4 + b'\0'
move = bytes([0x03, 0x10, 0x20, 0x30, 0x40])
payload = join + auth + move
header = b'IPTCPHEADER'
clean = pc.redact_client(header + payload, payload)

assert clean[:len(header)] == header
out = clean[len(header):]
assert len(out) == len(payload)
assert out[1:7] == bytes(6) and out[8:21] == bytes(13), 'game hash and token blanked'
assert out[7] == 3 and out[21:27] == b'Vitsin', 'class and name kept for the replay'
assert out[38:38 + 32] == b'0' * 32 and out[70] == 0, 'auth blob blanked, terminator kept'
assert out[-5:] == move, 'other packets untouched'
assert pc.redact_client(header + move, move) == header + move
print('ok')
