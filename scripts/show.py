#!/usr/bin/env python3
"""Pretty-print scripts/call.ts output: one block per tool with the fields that matter during discovery."""
import json
import sys

KEYS = ("message", "code", "url", "media_count", "screenshot", "scene_url", "scene_id", "clip_index", "path", "status")
txt = sys.stdin.read()
for block in txt.split("### ")[1:]:
    name, _, body = block.partition("\n")
    try:
        d = json.loads(body)
    except Exception:
        print(name, body[:400])
        continue
    print("==", name, "ok=", d.get("ok"))
    for k in KEYS:
        if k in d:
            print("  ", k, ":", str(d[k])[:160])
    if "details" in d and d["details"]:
        print("   details:", json.dumps(d["details"], ensure_ascii=False)[:400])
    for k in ("added", "removed", "matches"):
        if k in d:
            print("   %s (%d):" % (k, len(d[k])))
            for r in d[k][:40]:
                print("     ", r[:160])
    if "clips" in d:
        print("   clips:", json.dumps(d["clips"], ensure_ascii=False)[:600])
