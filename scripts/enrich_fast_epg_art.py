#!/usr/bin/env python3

from pathlib import Path
from datetime import datetime, timezone
import xml.etree.ElementTree as ET
import json
import re
import shutil

ROOT = Path(__file__).resolve().parent.parent
XML = ROOT / "docs" / "epg6-live.xml"
FAST = ROOT / "docs" / "epg-now-next.json"

def clean_title(value):
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()

def xmltv_ms(value):
    if not value:
        return None

    value = str(value).strip()

    try:
        if re.match(r"^\d{14}\s+[+-]\d{4}$", value):
            dt = datetime.strptime(value, "%Y%m%d%H%M%S %z")
            return int(dt.timestamp() * 1000)

        if re.match(r"^\d{14}", value):
            dt = datetime.strptime(value[:14], "%Y%m%d%H%M%S")
            dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1000)
    except Exception:
        pass

    return None

def item_ms(value):
    if value is None:
        return None

    if isinstance(value, (int, float)):
        value = int(value)
        return value * 1000 if value < 100000000000 else value

    s = str(value).strip()

    if s.isdigit():
        value = int(s)
        return value * 1000 if value < 100000000000 else value

    return xmltv_ms(s)

print("====================================")
print("LOUNGE FAST EPG ARTWORK ENRICHMENT")
print("====================================")

if not XML.exists():
    raise SystemExit("Missing: " + str(XML))

if not FAST.exists():
    raise SystemExit("Missing: " + str(FAST))

# ------------------------------------------------------------
# Build programme artwork lookup directly from XMLTV
# ------------------------------------------------------------

art = {}
art_count = 0

for event, elem in ET.iterparse(XML, events=("end",)):
    if elem.tag != "programme":
        continue

    icon = elem.find("icon")
    title_el = elem.find("title")

    if (
        icon is None or
        not icon.get("src") or
        title_el is None or
        not title_el.text
    ):
        elem.clear()
        continue

    channel = (elem.get("channel") or "").strip()
    title = clean_title(title_el.text)
    start = xmltv_ms(elem.get("start"))
    image = icon.get("src").strip()

    if channel and title and image:
        key = (channel, title)

        art.setdefault(key, []).append({
            "start": start,
            "image": image
        })

        art_count += 1

    elem.clear()

print("Artwork records found:", art_count)

# ------------------------------------------------------------
# Load existing fast EPG
# ------------------------------------------------------------

data = json.loads(FAST.read_text(encoding="utf-8"))

if not isinstance(data, dict):
    raise SystemExit("Unexpected epg-now-next.json format")

matched = 0
programme_items = 0
samples = []

for channel, items in data.items():

    if channel.startswith("_"):
        continue

    if not isinstance(items, list):
        continue

    for item in items:

        if not isinstance(item, dict):
            continue

        programme_items += 1

        title = (
            item.get("title") or
            item.get("name") or
            item.get("programme") or
            ""
        )

        title_key = clean_title(title)

        if not title_key:
            continue

        candidates = art.get((channel, title_key))

        if not candidates:
            continue

        raw_start = (
            item.get("start")
            if item.get("start") is not None
            else item.get("begin")
        )

        start = item_ms(raw_start)

        chosen = None

        if start is not None:
            valid = [
                x for x in candidates
                if x["start"] is not None
            ]

            if valid:
                chosen = min(
                    valid,
                    key=lambda x: abs(x["start"] - start)
                )

        if chosen is None:
            chosen = candidates[0]

        image = chosen.get("image")

        if not image:
            continue

        item["image"] = image
        matched += 1

        if len(samples) < 10:
            samples.append({
                "channel": channel,
                "title": title,
                "image": image
            })

print("Fast programme entries:", programme_items)
print("Artwork matched:", matched)

# Safety: do not overwrite if our assumptions are wrong.
if matched < 100:
    raise SystemExit(
        "STOP: fewer than 100 artwork matches. "
        "epg-now-next.json was NOT overwritten."
    )

backup = FAST.with_suffix(".json.before_artwork")

if not backup.exists():
    shutil.copy2(FAST, backup)

FAST.write_text(
    json.dumps(
        data,
        ensure_ascii=False,
        separators=(",", ":")
    ),
    encoding="utf-8"
)

print()
print("Sample matches:")

for x in samples:
    print("-", x["channel"], "|", x["title"])
    print(" ", x["image"])

print()
print("Updated:", FAST)
print("Backup:", backup)
print("Size:", round(FAST.stat().st_size / 1024 / 1024, 2), "MB")
