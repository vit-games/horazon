#!/usr/bin/env python3
"""Replay a recording into a Horazon server as if it were being played now, for trying the live
views (kill counter, boss timer, overlays) without the game:

  python3 capture/simulate.py capture/fixtures/uber-tristram-t0-4-entries-kill.pcap http://127.0.0.1:8099/api/capture/events [speed]

Events are re-timed from now, `speed` times faster (default 1; times on screen shrink with it),
under a game id of their own so a replay never continues the recorded game. Point it at a test
server (its own PGLITE_DIR), not the app's database.
"""
import json, os, sys, time, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pd2capture as pc

path, url = sys.argv[1], sys.argv[2]
speed = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
evs = []
original = pc.on_ip


def on_ip(tracker, ts, pkt):
    original(tracker, ts, pkt)
    tracker.tick(ts)  # live capture ticks every second (kills, boss HP); a plain replay doesn't


pc.on_ip = on_ip
pc.replay(path, pc.Tracker(evs.append))
if not evs:
    sys.exit('no events in the recording')
t0, start, run = evs[0]['ts'], time.time() * 1000, f'-sim{int(time.time())}'


def post(batch):
    req = urllib.request.Request(url, json.dumps({'events': batch}).encode(), {'Content-Type': 'application/json'})
    urllib.request.urlopen(req).read()


batch = []
for e in evs:
    at = start + (e['ts'] - t0) / speed
    wait = (at - time.time() * 1000) / 1000
    if wait > 0.2 and batch:
        post(batch)
        batch = []
    if wait > 0:
        time.sleep(wait)
    batch.append({**e, 'game': e['game'] + run, 'ts': round(at)})
    if e['type'] in ('area', 'uber_used', 'uber_killed', 'death', 'boss'):
        print(f"{(time.time() * 1000 - start) / 1000:6.1f}s {e['type']} {e.get('area', e.get('name', ''))}", flush=True)
post(batch)
