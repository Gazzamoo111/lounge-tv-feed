#!/usr/bin/env python3

import json
import re
import xml.etree.ElementTree as ET

from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "epg6-live.xml"
OUTPUT = ROOT / "docs" / "epg-now-next.json"


def parse_time(value):
    if not value:
        return 0

    m = re.match(r"^(\d{14})(?:\s+([+-]\d{4}))?", value.strip())

    if not m:
        return 0

    dt = datetime.strptime(m.group(1), "%Y%m%d%H%M%S")

    offset = m.group(2)

    if offset:
        sign = 1 if offset[0] == "+" else -1

        tz = timezone(
            sign * timedelta(
                hours=int(offset[1:3]),
                minutes=int(offset[3:5])
            )
        )

        dt = dt.replace(tzinfo=tz).astimezone(timezone.utc)
    else:
        dt = dt.replace(tzinfo=timezone.utc)

    return int(dt.timestamp() * 1000)


def text_of(node, tag):
    found = node.find(tag)

    if found is None or found.text is None:
        return ""

    return found.text.strip()


now = int(datetime.now(timezone.utc).timestamp() * 1000)

by_channel = {}

for event, elem in ET.iterparse(SOURCE, events=("end",)):
    if elem.tag != "programme":
        continue

    channel = elem.attrib.get("channel", "")

    if not channel:
        elem.clear()
        continue

    start = parse_time(elem.attrib.get("start"))
    stop = parse_time(elem.attrib.get("stop"))

    if not start or not stop:
        elem.clear()
        continue

    if stop < now:
        elem.clear()
        continue

    by_channel.setdefault(channel, []).append({
        "start": start,
        "stop": stop,
        "title": text_of(elem, "title"),
        "description": text_of(elem, "desc")
    })

    elem.clear()


result = {}

for channel, programmes in by_channel.items():
    programmes.sort(key=lambda p: p["start"])

    current = None
    future = []

    for p in programmes:
        if p["start"] <= now < p["stop"]:
            current = p
        elif p["start"] > now:
            future.append(p)

    selected = []

    if current:
        selected.append(current)

    selected.extend(future[:2])

    if selected:
        result[channel] = selected


OUTPUT.write_text(
    json.dumps(
        result,
        separators=(",", ":"),
        ensure_ascii=False
    ),
    encoding="utf-8"
)

count = sum(len(v) for v in result.values())

print("Channels:", len(result))
print("Programmes:", count)
print("Size:", round(OUTPUT.stat().st_size / 1024 / 1024, 2), "MB")
print("FAST EPG READY")
