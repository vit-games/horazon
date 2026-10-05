#!/usr/bin/env python3
"""Extract item image data from the official projectdiablo2.com web bundle.

The PD2 website ships its game data (bases, uniques, set items) as JS literals
inside its main bundle. We pull out just what's needed to render item icons:
invfile (image name) and invtransform (tint class), plus base names/sizes.

Re-run after a PD2 patch:  python3 scripts/extract_game_data.py
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

SITE = "https://www.projectdiablo2.com"
OUT = Path(__file__).resolve().parent.parent / "web" / "src" / "data" / "game-data.json"

# (kind marker, output key)
ARRAYS = {
    "item.base.armor": "bases",
    "item.base.weapon": "bases",
    "item.base.misc": "bases",
    "item.unique": "uniques",
    "item.set-item": "sets",
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "pd2-loot-tracker"})
    with urllib.request.urlopen(req) as r:
        return r.read().decode("utf-8", errors="replace")


def match_bracket(s: str, start: int) -> int:
    """Return index just past the bracket that closes s[start]."""
    depth, i, in_str = 0, start, None
    while i < len(s):
        c = s[i]
        if in_str:
            if c == "\\":
                i += 1
            elif c == in_str:
                in_str = None
        elif c in "\"'`":
            in_str = c
        elif c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError("unbalanced brackets")


def js_to_json(src: str) -> str:
    """Convert a minified JS literal (unquoted keys, !0/!1, void 0) to JSON."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == '"':
            j = i + 1
            while src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            out.append(src[i : j + 1])
            i = j + 1
            continue
        if src.startswith("!0", i):
            out.append("true"); i += 2; continue
        if src.startswith("!1", i):
            out.append("false"); i += 2; continue
        if src.startswith("void 0", i):
            out.append("null"); i += 6; continue
        m = re.match(r"[A-Za-z_$][\w$]*(?=:)", src[i:])
        if m and out and out[-1][-1:] in "{,":
            out.append(f'"{m.group(0)}"'); i += m.end(); continue
        m = re.match(r"(?<![\w.])\.\d", src[i:])
        if m and (not out or not out[-1][-1:].isalnum()):
            out.append("0"); out.append(src[i]); i += 1; continue
        out.append(c)
        i += 1
    return "".join(out)


def main() -> None:
    html = fetch(f"{SITE}/market")
    bundle_path = re.search(r'src="(/assets/index\.[^"]+\.js)"', html).group(1)
    bundle = fetch(SITE + bundle_path)

    data = {"bases": {}, "uniques": {}, "sets": {}}
    for kind, key in ARRAYS.items():
        m = re.search(r'\[\{id:0,kind:"' + re.escape(kind) + '"', bundle)
        if not m:
            sys.exit(f"could not find array for {kind}")
        arr = json.loads(js_to_json(bundle[m.start() : match_bracket(bundle, m.start())]))
        for it in arr:
            img = it.get("image") or {}
            entry = {"img": img.get("invfile")}
            if img.get("invtransform"):
                entry["tint"] = img["invtransform"]
            if key == "bases":
                entry["name"] = it.get("name")
                entry["type"] = it.get("type")
                size = it.get("size") or {}
                entry["w"], entry["h"] = size.get("width", 1), size.get("height", 1)
                data[key][it["key"]] = entry
            else:
                entry["base"] = it.get("base_code")
                # In-game index (sent in item packets once identified; see web/src/lib/capture.ts)
                entry["id"] = it.get("id")
                if it.get("set_code"):
                    entry["set"] = it["set_code"]
                data[key][it["name"]] = entry

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":"), sort_keys=True))
    print(f"wrote {OUT} ({', '.join(f'{k}: {len(v)}' for k, v in data.items())})")


if __name__ == "__main__":
    main()
