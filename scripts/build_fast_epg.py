#!/usr/bin/env python3

import json
import re
import xml.etree.ElementTree as ET

from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "epg6-live.xml"
PLAYLIST = ROOT / "docs" / "lounge-clean.m3u"
OUTPUT = ROOT / "docs" / "epg-now-next.json"
GUIDE_OUTPUT = ROOT / "docs" / "epg-guide.json"

ATTR_RE = re.compile(r'([\w-]+)="([^"]*)"')


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


def normal(value):
    return re.sub(
        r"[^a-z0-9]+",
        "",
        re.sub(
            r"\b(uhd|4k|fhd|hd|sd|1080p?|720p?|576p?|50fps|60fps|50hz|60hz|vip|raw|backup|alt|feed)\b",
            "",
            re.sub(
                r"^\s*(uk|us|usa|au|aus|nz)\s*[\|\:\-]\s*",
                "",
                str(value or "").lower()
            )
        )
    )


def attrs(line):
    return {
        k.lower(): v
        for k, v in ATTR_RE.findall(line)
    }


now = int(datetime.now(timezone.utc).timestamp() * 1000)
fast_horizon = now + (12 * 60 * 60 * 1000)\nhorizon = now + (24 * 60 * 60 * 1000)

by_channel = {}
alias_candidates = {}
known_channel_ids = set()

for event, elem in ET.iterparse(SOURCE, events=("end",)):
    if elem.tag == "channel":
        channel_id = elem.attrib.get("id", "").strip()

        if channel_id:
            known_channel_ids.add(channel_id)

            names = [
                x.text.strip()
                for x in elem.findall("display-name")
                if x.text and x.text.strip()
            ]

            names.append(channel_id)

            for name in names:
                key = normal(name)

                if not key:
                    continue

                alias_candidates.setdefault(
                    key,
                    set()
                ).add(channel_id)

        elem.clear()
        continue

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


# Only use aliases that resolve to exactly one EPG channel.
aliases = {}

for key, values in alias_candidates.items():
    if len(values) != 1:
        continue

    target = next(iter(values))

    if target in by_channel:
        aliases[key] = target


# Add playlist names/tvg-names as aliases to the EPG id wherever
# an exact id or an unambiguous EPG display-name match exists.
if PLAYLIST.exists():
    pending = None

    for raw_line in PLAYLIST.read_text(
        encoding="utf-8",
        errors="ignore"
    ).splitlines():
        line = raw_line.strip()

        if line.startswith("#EXTINF"):
            pending = line
            continue

        if not pending or not line or line.startswith("#"):
            continue

        a = attrs(pending)
        display_name = (
            pending.split(",", 1)[1].strip()
            if "," in pending
            else ""
        )

        tvg_id = a.get("tvg-id", "").strip()
        tvg_name = a.get("tvg-name", "").strip()

        target = None

        if tvg_id in by_channel:
            target = tvg_id
        else:
            for candidate in [tvg_name, display_name, tvg_id]:
                key = normal(candidate)

                if key and key in aliases:
                    target = aliases[key]
                    break

        if target:
            for candidate in [tvg_id, tvg_name, display_name]:
                key = normal(candidate)

                if key:
                    aliases[key] = target

        pending = None


result = {"_aliases": aliases}
guide_result = {"_aliases": aliases}

for channel, programmes in by_channel.items():
    programmes.sort(key=lambda p: p["start"])

    current = None
    future = []

    for p in programmes:
        if p["start"] <= now < p["stop"]:
            current = p
        elif p["start"] > now:
            future.append(p)

    fast_selected = []
    guide_selected = []

    if current:
        fast_selected.append(current)
        guide_selected.append(current)

    for p in future:
        if p["start"] > fast_horizon:
            break

        compact = {
            "start": p["start"],
            "stop": p["stop"],
            "title": p.get("title", "")
        }

        # Keep descriptions for the next two items only. This gives Lounge
        # useful immediate programme detail without bloating the hourly feed.
        if len(fast_selected) < 3 and p.get("description"):
            compact["description"] = p["description"]

        fast_selected.append(compact)

    guide_selected.extend([p for p in future if p["start"] <= horizon])

    if fast_selected:
        result[channel] = fast_selected
    if guide_selected:
        guide_result[channel] = guide_selected

OUTPUT.write_text(
    json.dumps(result, separators=(",", ":"), ensure_ascii=False),
    encoding="utf-8"
)

GUIDE_OUTPUT.write_text(
    json.dumps(guide_result, separators=(",", ":"), ensure_ascii=False),
    encoding="utf-8"
)

count = sum(len(v) for k, v in result.items() if not k.startswith("_"))
guide_count = sum(len(v) for k, v in guide_result.items() if not k.startswith("_"))

print("Fast channels:", len(result) - 1)
print("Fast programmes:", count)
print("Fast size:", round(OUTPUT.stat().st_size / 1024 / 1024, 2), "MB")
print("Guide channels:", len(guide_result) - 1)
print("Guide programmes:", guide_count)
print("Guide size:", round(GUIDE_OUTPUT.stat().st_size / 1024 / 1024, 2), "MB")
print("Aliases:", len(aliases))
print("FAST 12H + 24H GUIDE EPG READY")

# Programme artwork is now resolved locally in Lounge TV from the bundled
# high-confidence TMDB manifest. Keeping image URLs out of this hourly EPG
# feed makes startup smaller and more reliable on TV hardware.
