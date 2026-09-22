#!/usr/bin/env python3

import gzip
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

from datetime import datetime, timedelta, timezone
from pathlib import Path


PLAYLIST_URL = (
    "https://drive.usercontent.google.com/download"
    "?id=1QjgcT2gMx_9AES4EwwU6aM-R69Aau8Ck&confirm=t"
)

EPG_URL = (
    "https://raw.githubusercontent.com/"
    "ferteque/Curated-M3U-Repository/main/epg6.xml.gz"
)

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

RAW_M3U = DOCS / "ganja-source.m3u"
CLEAN_M3U = DOCS / "lounge-clean.m3u"
EPG_GZ = DOCS / "epg6.xml.gz"
EPG_OUT = DOCS / "epg6-live.xml"


def download(url, path):
    print("Downloading:", url)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LoungeTV/1.0"
        }
    )

    with urllib.request.urlopen(req, timeout=180) as response:
        with open(path, "wb") as f:
            while True:
                chunk = response.read(1024 * 1024)

                if not chunk:
                    break

                f.write(chunk)

    print("Downloaded:", path, path.stat().st_size, "bytes")


ATTR_RE = re.compile(r'([\w-]+)="([^"]*)"')


def attrs(line):
    return {
        k.lower(): v
        for k, v in ATTR_RE.findall(line)
    }


def txt(*values):
    return " ".join(str(v or "") for v in values).lower()


BUSINESS_KEEP = (
    "bloomberg",
    "cnbc",
    "fox business",
    "cheddar",
    "yahoo finance",
)


KEEP_247 = (
    "adventure",
    "kids",
    "family",
    "movie",
    "cinema",
    "documentary",
    "documentaries",
    "wrestling",
    "wwe",
    "pawn stars",
    "storage wars",
    "gold rush",
    "shark tank",
    "american pickers",
    "house hunters",
    "property brothers",
    "fixer upper",
    "animation",
    "animated",
    "pixar",
    "bluey",
    "spongebob",
    "paw patrol",
    "tom and jerry",
    "disney",
)


def should_keep(extinf):
    a = attrs(extinf)

    group = a.get("group-title", "")
    name = extinf.split(",", 1)[1] if "," in extinf else ""

    t = txt(group, name)

    if "canada" in t or " canadian" in t:
        return False

    if "ireland" in t or "irish" in t:
        return False

    if "news" in group.lower():
        if any(x in t for x in BUSINESS_KEEP):
            return True

        return False

    if "24/7" in t:
        return any(x in t for x in KEEP_247)

    return True


def clean_playlist():
    text = RAW_M3U.read_text(
        encoding="utf-8",
        errors="ignore"
    )

    lines = text.splitlines()

    out = ["#EXTM3U"]
    kept = 0
    original = 0
    ids = set()

    pending = None

    for line in lines:
        line = line.strip()

        if not line:
            continue

        if line.startswith("#EXTINF"):
            original += 1
            pending = line
            continue

        if pending and not line.startswith("#"):
            if should_keep(pending):
                out.append(pending)
                out.append(line)

                kept += 1

                a = attrs(pending)
                tvg_id = a.get("tvg-id", "").strip()

                if tvg_id:
                    ids.add(tvg_id)

            pending = None

    if kept < 10000:
        raise RuntimeError(
            "Safety stop: cleaned playlist unexpectedly small: "
            + str(kept)
        )

    if kept > 17000:
        raise RuntimeError(
            "Safety stop: cleanup unexpectedly kept too much: "
            + str(kept)
        )

    CLEAN_M3U.write_text(
        "\n".join(out) + "\n",
        encoding="utf-8"
    )

    print("Original channels:", original)
    print("Clean channels:", kept)
    print("EPG IDs:", len(ids))

    return ids


def parse_xmltv_time(value):
    if not value:
        return None

    value = value.strip()

    m = re.match(
        r"^(\d{14})(?:\s+([+-]\d{4}))?",
        value
    )

    if not m:
        return None

    dt = datetime.strptime(
        m.group(1),
        "%Y%m%d%H%M%S"
    )

    offset = m.group(2)

    if offset:
        sign = 1 if offset[0] == "+" else -1
        hours = int(offset[1:3])
        minutes = int(offset[3:5])

        tz = timezone(
            sign * timedelta(
                hours=hours,
                minutes=minutes
            )
        )

        dt = dt.replace(tzinfo=tz)
        return dt.astimezone(timezone.utc)

    return dt.replace(tzinfo=timezone.utc)


def build_epg(wanted_ids):
    now = datetime.now(timezone.utc)

    start_window = now - timedelta(hours=1)
    end_window = now + timedelta(hours=10)

    output = ET.Element("tv")

    channel_count = 0
    programme_count = 0

    with gzip.open(EPG_GZ, "rb") as source:
        context = ET.iterparse(
            source,
            events=("end",)
        )

        for event, elem in context:
            if elem.tag == "channel":
                channel_id = elem.attrib.get("id", "")

                if channel_id in wanted_ids:
                    output.append(elem)
                    channel_count += 1
                else:
                    elem.clear()

            elif elem.tag == "programme":
                channel_id = elem.attrib.get(
                    "channel",
                    ""
                )

                if channel_id not in wanted_ids:
                    elem.clear()
                    continue

                start = parse_xmltv_time(
                    elem.attrib.get("start")
                )

                stop = parse_xmltv_time(
                    elem.attrib.get("stop")
                )

                relevant = False

                if start and stop:
                    relevant = (
                        stop >= start_window
                        and start <= end_window
                    )

                if relevant:
                    output.append(elem)
                    programme_count += 1
                else:
                    elem.clear()

    tree = ET.ElementTree(output)

    tree.write(
        EPG_OUT,
        encoding="utf-8",
        xml_declaration=True
    )

    print("EPG channels:", channel_count)
    print("EPG programmes:", programme_count)
    print(
        "EPG output:",
        EPG_OUT.stat().st_size,
        "bytes"
    )

    if channel_count < 5000:
        raise RuntimeError(
            "Safety stop: too few matching EPG channels"
        )

    if programme_count < 10000:
        raise RuntimeError(
            "Safety stop: too few EPG programmes"
        )


def playlist_ids():
    text = CLEAN_M3U.read_text(
        encoding="utf-8",
        errors="ignore"
    )

    ids = set()
    count = 0

    for line in text.splitlines():
        if not line.startswith("#EXTINF"):
            continue

        count += 1
        a = attrs(line)
        tvg_id = a.get("tvg-id", "").strip()

        if tvg_id:
            ids.add(tvg_id)

    if count < 10000:
        raise RuntimeError(
            "Safety stop: committed Lounge playlist unexpectedly small"
        )

    print("Stable Lounge channels:", count)
    print("EPG IDs:", len(ids))

    return ids


def main():
    DOCS.mkdir(
        parents=True,
        exist_ok=True
    )

    if not CLEAN_M3U.exists():
        raise RuntimeError(
            "Stable docs/lounge-clean.m3u is missing"
        )

    wanted_ids = playlist_ids()

    download(
        EPG_URL,
        EPG_GZ
    )

    build_epg(wanted_ids)

    EPG_GZ.unlink(
        missing_ok=True
    )

    print()
    print("LOUNGE CLOUD FEEDS READY")
    print(CLEAN_M3U)
    print(EPG_OUT)


if __name__ == "__main__":
    main()
