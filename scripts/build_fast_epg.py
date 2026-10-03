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
# LOUNGE_PREPARED_EVENT_FEED_V2

import hashlib
from zoneinfo import ZoneInfo

EVENTS_OUTPUT = ROOT / "docs" / "lounge-events.json"
EVENT_HORIZON = now + (7 * 24 * 60 * 60 * 1000)
CURRENT_YEAR = datetime.now(timezone.utc).year


def event_norm(value):
    return re.sub(
        r"\s+",
        " ",
        re.sub(r"[^a-z0-9@]+", " ", str(value or "").lower())
    ).strip()


def clean_event_title(value):
    value = str(value or "").strip()

    value = re.sub(
        r"^[A-Z]{2}\s+\(STAN\s+\d+\)\s*\|\s*",
        "",
        value,
        flags=re.I
    )

    value = re.sub(
        r"\s*\(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\)\s*$",
        "",
        value
    )

    value = re.sub(
        r"[ᴸᶦᵛᵉᴺᵉʷᴿᴬᵂ]+",
        "",
        value
    )

    return re.sub(r"\s+", " ", value).strip()


def explicit_event_time(title):
    m = re.search(
        r"\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\)",
        str(title or "")
    )

    if not m:
        return 0

    try:
        dt = datetime.strptime(
            m.group(1) + " " + m.group(2),
            "%Y-%m-%d %H:%M:%S"
        )

        # STAN event-feed timestamps are Australian Eastern local time.
        dt = dt.replace(
            tzinfo=ZoneInfo("Australia/Sydney")
        ).astimezone(timezone.utc)

        return int(dt.timestamp() * 1000)
    except Exception:
        return 0


def old_archive_year(title):
    years = [
        int(x)
        for x in re.findall(r"\b(19\d{2}|20\d{2})\b", title)
    ]

    return any(
        y < CURRENT_YEAR - 1
        for y in years
    )


def real_matchup(title):
    if re.search(r"\btbc\b", title, re.I):
        return False

    return bool(
        re.search(
            r"[A-Za-z0-9][A-Za-z0-9 .&'()\-]{1,50}"
            r"\s+(?:v|vs\.?|@|at)\s+"
            r"[A-Za-z0-9][A-Za-z0-9 .&'()\-]{1,50}",
            title,
            flags=re.I
        )
    )


NOISE = re.compile(
    r"\b("
    r"highlights?|hls|mini|replay|classic|throwback|archive|rewind|"
    r"preview|countdown|embedded|vlog|on the line|full fight|"
    r"press conference|weigh[- ]?in|post[- ]?fight|"
    r"top\s+\d+|grand final edition|"
    r"game of the week|weekly game previews?|"
    r"fantasy focus|sportscenter|nba today|nfl live|"
    r"redzone|every sunday afternoon|"
    r"news|magazine|roundup"
    r")\b",
    re.I
)


def classify_real_event(title, channel_id):
    raw = str(title or "").strip()
    title = clean_event_title(raw)
    low = title.lower()
    channel = str(channel_id or "").lower()

    if not title:
        return None

    if NOISE.search(title):
        return None

    if old_archive_year(title):
        return None

    # Exclude generic archive / 24-7 feeds.
    if "24_7" in channel or "24/7" in channel:
        return None

    # Generic placeholder feeds such as UFC 01, UFC 02...
    if re.fullmatch(
        r"ufc\s+\d{1,2}\s*:?",
        title,
        flags=re.I
    ):
        return None

    matchup = real_matchup(title)

    finalish = bool(
        re.search(
            r"\b("
            r"grand final|semi[ -]?final|quarter[ -]?final|"
            r"finals?|playoffs?|championship|title fight|"
            r"world cup|super bowl"
            r")\b",
            low
        )
    )

    # COMBAT
    if re.search(r"\bufc\b", low):
        if matchup:
            return ("UFC / MMA", 320)
        return None

    if re.search(r"\b(?:bkfc|bare knuckle)\b", low):
        if matchup or re.search(r"\bbkfc\s+\d+\b", low):
            return ("Bare Knuckle", 315)
        return None

    if re.search(r"\bboxing\b", low):
        if matchup:
            return ("Boxing", 310)
        return None

    if re.search(
        r"\b(?:wrestlemania|royal rumble|summerslam|"
        r"survivor series|money in the bank|elimination chamber|"
        r"crown jewel|backlash)\b",
        low
    ):
        return ("Wrestling", 300)

    # NZ / AU / RUGBY
    if re.search(r"\bnrlw?\b", low):
        if finalish:
            return ("Rugby League", 300)
        if matchup:
            return ("Rugby League", 255)
        return None

    if re.search(
        r"\b(?:npc|bunnings npc|national provincial championship)\b",
        low
    ):
        if matchup:
            return ("Rugby", 270)
        return None

    if re.search(
        r"\b(?:super rugby|rugby championship|rugby union|rugby league)\b",
        low
    ):
        if finalish:
            return ("Rugby", 290)
        if matchup:
            return ("Rugby", 250)
        return None

    # US SPORT
    if (
        re.search(r"\bnfl\b", low)
        or "nfl" in channel
    ):
        if matchup:
            return ("NFL", 260)
        return None

    if (
        re.search(r"\bnba\b", low)
        or "nba" in channel
    ):
        if matchup:
            return ("NBA", 235)
        return None

    if (
        re.search(r"\bnhl\b", low)
        or "nhl" in channel
    ):
        if matchup:
            return ("NHL", 230)
        return None

    if (
        re.search(r"\bmlb\b", low)
        or "mlb" in channel
    ):
        if matchup:
            return ("MLB", 230)
        return None

    # OTHER MAJOR SPORT
    if re.search(r"\baflw?\b", low):
        if matchup:
            return ("AFL", 230)
        return None

    if re.search(
        r"\b(?:premier league|champions league|europa league|"
        r"a-league|football|soccer)\b",
        low
    ):
        if matchup:
            return ("Football", 220)
        return None

    if re.search(r"\bcricket\b", low):
        if matchup or finalish:
            return ("Cricket", 220)
        return None

    if re.search(
        r"\b(?:formula 1|f1|motogp|supercars|grand prix)\b",
        low
    ):
        if re.search(
            r"\b(?:race|qualifying|grand prix)\b",
            low
        ):
            return ("Motorsport", 150)

    if re.search(r"\b(?:pga|golf)\b", low):
        if finalish:
            return ("Golf", 120)

    if re.search(r"\b(?:atp|wta|tennis)\b", low):
        if finalish:
            return ("Tennis", 120)

    return None


# Reconstruct the exact EPG IDs actually represented in Lounge's playlist.
active_epg_ids = set()

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
            for candidate in [
                tvg_name,
                display_name,
                tvg_id
            ]:
                key = normal(candidate)

                if key and key in aliases:
                    target = aliases[key]
                    break

        if target:
            active_epg_ids.add(target)

        pending = None


prepared_by_key = {}

for channel_id, programmes in by_channel.items():

    # Only generate Home events from channels Lounge actually carries.
    if active_epg_ids and channel_id not in active_epg_ids:
        continue

    # Dummy feeds are permitted only when they are explicit STAN event feeds.
    is_dummy = str(channel_id).lower().startswith("dummy-")

    for programme in programmes:

        raw_title = str(
            programme.get("title") or ""
        ).strip()

        if is_dummy and not re.search(
            r"\bSTAN\s+\d+\b",
            raw_title,
            flags=re.I
        ):
            continue

        detail = classify_real_event(
            raw_title,
            channel_id
        )

        if not detail:
            continue

        sport_type, priority = detail

        start = explicit_event_time(raw_title)

        if not start:
            start = int(
                programme.get("start") or 0
            )

        stop = int(
            programme.get("stop") or 0
        )

        if not start:
            continue

        if start > EVENT_HORIZON:
            continue

        # Allow an event currently underway.
        if stop and stop <= now and not explicit_event_time(raw_title):
            continue

        title = clean_event_title(raw_title)

        key = (
            event_norm(title) +
            "|" +
            datetime.fromtimestamp(
                start / 1000,
                timezone.utc
            ).strftime("%Y-%m-%d")
        )

        event = {
            "id": "epg-" + hashlib.sha1(
                key.encode("utf-8")
            ).hexdigest()[:16],
            "title": title,
            "description": str(
                programme.get("description") or ""
            ).strip()[:600],
            "sportType": sport_type,
            "startTime": start,
            "endTime": stop,
            "channelId": channel_id,
            "priority": priority,
            "source": "epg-publisher"
        }

        existing = prepared_by_key.get(key)

        # Prefer the stronger/higher-priority representation.
        if (
            existing is None
            or priority > existing["priority"]
        ):
            prepared_by_key[key] = event


prepared_events = list(
    prepared_by_key.values()
)

prepared_events.sort(
    key=lambda item: (
        -int(item["priority"]),
        int(item["startTime"]),
        event_norm(item["title"])
    )
)

event_payload = {
    "version": datetime.now(
        timezone.utc
    ).isoformat(),
    "generatedAt": now,
    "horizonHours": 168,
    "events": prepared_events[:300]
}

EVENTS_OUTPUT.write_text(
    json.dumps(
        event_payload,
        separators=(",", ":"),
        ensure_ascii=False
    ),
    encoding="utf-8"
)

print()
print("QUALITY PREPARED FUTURE EVENTS")
print("================================")
print("Total:", len(event_payload["events"]))
print()

for event in event_payload["events"][:40]:

    when = datetime.fromtimestamp(
        event["startTime"] / 1000,
        timezone.utc
    ).isoformat()

    print(
        event["priority"],
        event["sportType"],
        when,
        "|",
        event["title"],
        "|",
        event["channelId"]
    )
