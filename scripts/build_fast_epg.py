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
fast_horizon = now + (12 * 60 * 60 * 1000)
horizon = now + (24 * 60 * 60 * 1000)

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


metadata = {
    "generatedAt": now,
    "fastHorizon": fast_horizon,
    "guideHorizon": horizon,
    "schema": "lounge-epg-v2"
}

result = {"_meta": metadata, "_aliases": aliases}
guide_result = {"_meta": metadata, "_aliases": aliases}

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


# =========================================================
# LOUNGE_PREPARED_EVENT_FEED_V1
#
# Build a small future-event manifest from the FULL XMLTV
# source. This is deliberately separate from the compact
# Now/Next client feed.
# =========================================================

EVENTS_OUTPUT = ROOT / "docs" / "lounge-events.json"
EVENT_HORIZON = now + (7 * 24 * 60 * 60 * 1000)

def event_norm(value):
    return re.sub(
        r"\s+",
        " ",
        re.sub(r"[^a-z0-9@]+", " ", str(value or "").lower())
    ).strip()


def prepared_event_detail(title, description=""):
    title = str(title or "").strip()
    description = str(description or "").strip()

    text = (title + " " + description).lower()

    if not title:
        return None

    # Programmes, repeats and studio content are not events.
    if re.search(
        r"\b("
        r"highlights?|replay|classic|throwback|archive|"
        r"preview|countdown|press conference|weigh[- ]?in|"
        r"post[- ]?fight|magazine|roundup|sportscenter|"
        r"nba today|nfl live|news"
        r")\b",
        text
    ):
        return None

    matchup = bool(
        re.search(
            r"\b(?:v|vs\.?|@)\b",
            title,
            flags=re.I
        )
    )

    finalish = bool(
        re.search(
            r"\b("
            r"grand final|semi[ -]?final|quarter[ -]?final|"
            r"finals?|playoffs?|championship|title fight|"
            r"world cup|test match|ashes"
            r")\b",
            text
        )
    )

    # Tier 1: marquee combat/finals/world events.
    if re.search(r"\bufc\s*(?:\d+|fight night)\b", text):
        return ("UFC / MMA", 320)

    if re.search(r"\b(?:bkfc|bare knuckle)\b", text):
        return ("Bare knuckle", 315)

    if re.search(
        r"\bboxing\b",
        text
    ) and (
        matchup or
        re.search(
            r"\b(?:fight|card|title|championship|main event)\b",
            text
        )
    ):
        return ("Boxing", 310)

    if re.search(
        r"\b(?:wrestlemania|royal rumble|summerslam|"
        r"survivor series|money in the bank|elimination chamber|"
        r"crown jewel|backlash|wwe ple)\b",
        text
    ):
        return ("Wrestling", 300)

    if re.search(r"\bnrlw?\b", text) and finalish:
        return ("Rugby League", 300)

    if re.search(
        r"\b(?:rugby|all blacks|wallabies|springboks)\b",
        text
    ) and finalish:
        return ("Rugby", 295)

    if re.search(r"\bcricket\b", text) and finalish:
        return ("Cricket", 290)

    # Tier 2: real fixtures.
    if re.search(
        r"\b(?:bunnings\s+)?npc\b|national provincial championship",
        text
    ) and (matchup or finalish):
        return ("Rugby", 255)

    if re.search(r"\bnrlw?\b", text) and matchup:
        return ("Rugby League", 250)

    if re.search(
        r"\b(?:rugby|super rugby|six nations|rugby championship)\b",
        text
    ) and matchup:
        return ("Rugby", 245)

    if re.search(r"\bnfl\b", text) and (
        matchup or
        re.search(r"\b(?:game|wild card|divisional|conference|super bowl)\b", text)
    ):
        return ("NFL", 245)

    if re.search(r"\bnba\b", text) and matchup:
        return ("NBA", 225)

    if re.search(r"\bnhl\b", text) and matchup:
        return ("NHL", 220)

    if re.search(r"\bmlb\b", text) and matchup:
        return ("MLB", 220)

    if re.search(r"\baflw?\b", text) and matchup:
        return ("AFL", 220)

    if re.search(
        r"\b(?:premier league|champions league|europa league|"
        r"football|soccer|a-league)\b",
        text
    ) and matchup:
        return ("Football", 215)

    if re.search(r"\bcricket\b", text) and (
        matchup or
        re.search(
            r"\b(?:odi|t20|test|ashes|world cup|champions trophy)\b",
            text
        )
    ):
        return ("Cricket", 215)

    # Tier 3: useful marquee events, only after major sport.
    if re.search(
        r"\b(?:tennis|golf|pga|atp|wta|formula 1|f1|motogp|"
        r"supercars|motorsport|athletics|swimming)\b",
        text
    ) and (
        finalish or
        re.search(
            r"\b(?:round\s*\d+|race|qualifying|grand prix)\b",
            text
        )
    ):
        return ("Other Sport", 120)

    return None


prepared_events = []
prepared_seen = set()

for channel_id, programmes in by_channel.items():

    for programme in programmes:

        start = int(programme.get("start") or 0)
        stop = int(programme.get("stop") or 0)

        if not start or not stop:
            continue

        if stop <= now:
            continue

        if start > EVENT_HORIZON:
            continue

        title = str(programme.get("title") or "").strip()
        description = str(
            programme.get("description") or ""
        ).strip()

        detail = prepared_event_detail(
            title,
            description
        )

        if not detail:
            continue

        sport_type, priority = detail

        key = (
            event_norm(title) +
            "|" +
            str(start)
        )

        if key in prepared_seen:
            continue

        prepared_seen.add(key)

        prepared_events.append({
            "id": "epg-" + str(abs(hash(key))),
            "title": title,
            "description": description[:600],
            "sportType": sport_type,
            "startTime": start,
            "endTime": stop,
            "channelId": channel_id,
            "priority": priority,
            "source": "epg-publisher"
        })


prepared_events.sort(
    key=lambda item: (
        -int(item.get("priority") or 0),
        int(item.get("startTime") or 0),
        event_norm(item.get("title"))
    )
)

event_payload = {
    "version": datetime.now(timezone.utc).isoformat(),
    "generatedAt": now,
    "horizonHours": 168,
    "events": prepared_events[:750]
}

EVENTS_OUTPUT.write_text(
    json.dumps(
        event_payload,
        separators=(",", ":"),
        ensure_ascii=False
    ),
    encoding="utf-8"
)

print(
    "Prepared future events:",
    len(event_payload["events"])
)

for event in event_payload["events"][:20]:
    print(
        event["priority"],
        event["sportType"],
        datetime.fromtimestamp(
            event["startTime"] / 1000,
            timezone.utc
        ).isoformat(),
        event["title"]
    )
