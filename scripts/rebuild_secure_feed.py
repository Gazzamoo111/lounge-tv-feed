#!/usr/bin/env python3
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
CONFIG = ROOT / "config" / "master_v5.json"
CLEAN = DOCS / "lounge-clean.m3u"
SECURE = DOCS / "lounge-secure.m3u"
CUID_RE = re.compile(r'\bcuid="([^"]+)"')
REL_RE = re.compile(r'\s+lounge-reliability="[^"]*"')
BACKUPS_RE = re.compile(r'\blounge-backups="([^"]*)"')


def split_extinf(line):
    quoted = False
    escaped = False
    for i, ch in enumerate(line):
        if ch == "\\" and not escaped:
            escaped = True
            continue
        if ch == '"' and not escaped:
            quoted = not quoted
        elif ch == "," and not quoted:
            return line[:i], line[i:]
        escaped = False
    raise RuntimeError("Malformed EXTINF line")


def stamp_reliability(line, reliability):
    line = REL_RE.sub("", line)
    if reliability is None:
        return line
    head, tail = split_extinf(line)
    return f'{head} lounge-reliability="{reliability}"{tail}'


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    records = {str(r.get("cuid", "")): r for r in config.get("records", [])}
    if len(records) < 1000:
        raise RuntimeError("Safety stop: MASTER V5 config unexpectedly small")

    lines = CLEAN.read_text(encoding="utf-8", errors="ignore").splitlines()
    clean_out = []
    secure_out = []
    if not lines or lines[0].strip() != "#EXTM3U":
        raise RuntimeError("Safety stop: clean playlist header missing")
    clean_out.append("#EXTM3U")
    secure_out.append("#EXTM3U")

    seen = set()
    backup_refs = []
    i = 1
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if not line.startswith("#EXTINF:"):
            raise RuntimeError(f"Safety stop: unexpected playlist line {i+1}")
        if i + 1 >= len(lines):
            raise RuntimeError("Safety stop: missing URL after EXTINF")
        url = lines[i + 1].strip()
        m = CUID_RE.search(line)
        if not m:
            raise RuntimeError(f"Safety stop: missing CUID at line {i+1}")
        cuid = m.group(1)
        rec = records.get(cuid)
        if not rec:
            raise RuntimeError(f"Safety stop: clean CUID {cuid} not in MASTER V5")
        line = stamp_reliability(line, rec.get("reliability"))
        clean_out.extend([line, url])
        secure_out.extend([line, f"lounge://channel/{cuid}?source={cuid}"])
        seen.add(cuid)
        bm = BACKUPS_RE.search(line)
        if bm:
            backup_refs.extend([x for x in bm.group(1).split(",") if x])
        i += 2

    if len(seen) != len(records):
        missing = sorted(set(records) - seen)
        extra = sorted(seen - set(records))
        raise RuntimeError(
            f"Safety stop: clean/master mismatch rows clean={len(seen)} master={len(records)} "
            f"missing={len(missing)} extra={len(extra)}"
        )

    missing_backups = sorted(set(backup_refs) - seen)
    if missing_backups:
        raise RuntimeError(
            "Safety stop: secure playlist would contain dangling backup refs: " +
            ",".join(missing_backups[:20])
        )

    CLEAN.write_text("\n".join(clean_out) + "\n", encoding="utf-8")
    SECURE.write_text("\n".join(secure_out) + "\n", encoding="utf-8")

    print("Lounge feed reliability metadata stamped:", len(seen), "rows")
    print("Secure feed rebuilt:", len(seen), "rows")
    print("Dangling backup refs: 0")
    print(CLEAN)
    print(SECURE)


if __name__ == "__main__":
    main()
