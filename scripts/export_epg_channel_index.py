#!/usr/bin/env python3
"""Export a compact auditable channel directory from Lounge's refreshed XMLTV.
No credentials, stream URLs, or programme descriptions are exported.
"""
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "epg6-live.xml"
DEST = ROOT / "docs" / "epg-channel-index.json"
NOW = datetime.now(timezone.utc).timestamp()
HORIZON = NOW + 12 * 3600

def time_value(text):
    m = re.match(r"^(\d{14})(?:\s+([+-]\d{4}))?", (text or "").strip())
    if not m:
        return 0
    dt = datetime.strptime(m.group(1), "%Y%m%d%H%M%S")
    off = m.group(2)
    if off:
        sign = 1 if off[0] == "+" else -1
        offset = timedelta(hours=int(off[1:3]), minutes=int(off[3:5]))
        dt = dt.replace(tzinfo=timezone(sign * offset))
    else:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()

entries = {}
for _, e in ET.iterparse(SOURCE, events=("end",)):
    if e.tag == "channel":
        ident = e.get("id", "").strip()
        if ident:
            names = list(dict.fromkeys(
                x.text.strip() for x in e.findall("display-name")
                if x.text and x.text.strip()
            ))
            entries[ident] = {"names": names[:8], "next12h": 0}
    elif e.tag == "programme":
        ident = e.get("channel", "")
        info = entries.get(ident)
        if info is not None:
            start, stop = time_value(e.get("start")), time_value(e.get("stop"))
            if start < HORIZON and stop > NOW:
                info["next12h"] += 1
    if e.tag in ("channel", "programme"):
        e.clear()

DEST.write_text(
    json.dumps({
        "_meta": {"generatedAt": int(NOW * 1000), "horizonHours": 12, "count": len(entries)},
        "channels": entries
    }, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8"
)
print("Published guide channel index:", len(entries), "channels; bytes:", DEST.stat().st_size)
