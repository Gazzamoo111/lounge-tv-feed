#!/usr/bin/env python3

import gzip
import json
import re
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
CONFIG = ROOT / "config" / "master_v5.json"

RAW_M3U = DOCS / "ganja-source.m3u"
CLEAN_M3U = DOCS / "lounge-clean.m3u"
MISSING_OUT = DOCS / "master-v5-missing.txt"
EPG_GZ = DOCS / "epg6.xml.gz"
EPG_OUT = DOCS / "epg6-live.xml"

ATTR_RE = re.compile(r'([\w-]+)="([^"]*)"')


def download(url, path):
    print("Downloading:", url)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "LoungeTV/0.4.49"}
    )

    with urllib.request.urlopen(req, timeout=180) as response:
        with open(path, "wb") as f:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)

    print("Downloaded:", path, path.stat().st_size, "bytes")


def attrs(line):
    return {
        k.lower(): v
        for k, v in ATTR_RE.findall(line)
    }


def esc_attr(value):
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace('"', "'")
        .replace("\r", " ")
        .replace("\n", " ")
    )


def parse_source():
    lines = RAW_M3U.read_text(
        encoding="utf-8",
        errors="ignore"
    ).splitlines()

    by_cuid = {}
    pending = None

    for raw in lines:
        line = raw.strip()

        if not line:
            continue

        if line.startswith("#EXTINF"):
            pending = line
            continue

        if pending and not line.startswith("#"):
            a = attrs(pending)
            cuid = a.get("cuid", "").strip()

            if cuid and cuid not in by_cuid:
                by_cuid[cuid] = {
                    "extinf": pending,
                    "attrs": a,
                    "name": (
                        pending.split(",", 1)[1].strip()
                        if "," in pending
                        else ""
                    ),
                    "url": line,
                }

            pending = None

    return by_cuid


def region_for(rec):
    category = rec.get("category", "")
    rail = rec.get("rail", "")
    source = str(rec.get("source", "")).lower()

    if category == "Australian TV":
        return "AU"

    if rail == "New Zealand Sport":
        return "NZ"

    if rail == "Australian Sport":
        return "AU"

    if rail == "USA Sport":
        return "USA"

    if rail == "UK Sport" or rail == "UK TV":
        return "UK"

    if rail == "US Entertainment":
        return "USA"

    if "uk|" in source:
        return "UK"

    if "au|" in source or "australia" in source:
        return "AU"

    if "nz|" in source or "new zealand" in source:
        return "NZ"

    return ""


def status_slug(value):
    t = str(value or "").lower()

    if "health" in t or "strict" in t or "recovery" in t:
        return "health-gated"

    if "dynamic" in t:
        return "dynamic"

    if "lock" in t or "normal" in t:
        return "locked"

    return "retain"


def make_extinf(source, rec):
    a = dict(source["attrs"])

    original_name = source["name"]
    display_name = (
        source["name"]
        if rec.get("layer") == "ppv"
        else rec.get("name") or source["name"]
    )

    if not a.get("tvg-id") and rec.get("tvg_id"):
        a["tvg-id"] = rec["tvg_id"]

    region = region_for(rec)

    group_parts = ["Lounge"]
    if region:
        group_parts.append(region)

    group_parts.append(rec.get("category") or "Other")

    if rec.get("rail"):
        group_parts.append(rec["rail"])

    a["group-title"] = " | ".join(group_parts)
    a["cuid"] = rec["cuid"]

    a["lounge-original-name"] = original_name
    a["lounge-category"] = rec.get("category", "")
    a["lounge-rail"] = rec.get("rail", "")
    a["lounge-layer"] = rec.get("layer", "")
    a["lounge-role"] = rec.get("role", "primary")
    a["lounge-root-cuid"] = rec.get("root_cuid", rec["cuid"])
    a["lounge-backups"] = ",".join(rec.get("backup_cuids") or [])
    a["lounge-status"] = status_slug(rec.get("status"))
    a["lounge-tier"] = rec.get("tier", "")

    preferred = [
        "tvg-id","tvg-name","tvg-logo","group-title","cuid",
        "lounge-original-name","lounge-category","lounge-rail",
        "lounge-layer","lounge-role","lounge-root-cuid",
        "lounge-backups","lounge-status","lounge-tier"
    ]

    bits = []

    for key in preferred:
        value = a.pop(key, None)

        if value not in (None, ""):
            bits.append(
                f'{key}="{esc_attr(value)}"'
            )

    for key in sorted(a):
        value = a[key]

        if value not in (None, ""):
            bits.append(
                f'{key}="{esc_attr(value)}"'
            )

    return (
        "#EXTINF:-1 " +
        " ".join(bits) +
        "," +
        display_name
    )


def clean_playlist():
    config = json.loads(
        CONFIG.read_text(encoding="utf-8")
    )

    wanted = config.get("records", [])

    if len(wanted) < 1000:
        raise RuntimeError(
            "Safety stop: MASTER V5 config unexpectedly small: " +
            str(len(wanted))
        )

    source = parse_source()

    out = ["#EXTM3U"]
    ids = set()
    kept = 0
    missing = []
    layers = {}

    for rec in wanted:
        cuid = str(rec.get("cuid", ""))

        item = source.get(cuid)

        if not item:
            missing.append(
                cuid + "\t" +
                str(rec.get("layer", "")) + "\t" +
                str(rec.get("name", ""))
            )
            continue

        out.append(
            make_extinf(item, rec)
        )
        out.append(item["url"])

        kept += 1

        layer = str(rec.get("layer", "other"))
        layers[layer] = layers.get(layer, 0) + 1

        tvg_id = item["attrs"].get("tvg-id", "").strip()

        if not tvg_id:
            tvg_id = str(rec.get("tvg_id", "")).strip()

        if tvg_id:
            ids.add(tvg_id)

    if kept < 900:
        raise RuntimeError(
            "Safety stop: fewer than 900 MASTER V5 rows matched upstream: " +
            str(kept)
        )

    if kept > 1800:
        raise RuntimeError(
            "Safety stop: MASTER V5 output unexpectedly large: " +
            str(kept)
        )

    CLEAN_M3U.write_text(
        "\n".join(out) + "\n",
        encoding="utf-8"
    )

    MISSING_OUT.write_text(
        "\n".join(missing) + ("\n" if missing else ""),
        encoding="utf-8"
    )

    print("MASTER V5 requested:", len(wanted))
    print("MASTER V5 matched:", kept)
    print("MASTER V5 missing:", len(missing))
    print("Layer counts:", layers)
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
    print("EPG output:", EPG_OUT.stat().st_size, "bytes")

    if channel_count < 50:
        raise RuntimeError(
            "Safety stop: too few MASTER V5 EPG channels"
        )

    if programme_count < 100:
        raise RuntimeError(
            "Safety stop: too few MASTER V5 EPG programmes"
        )


def main():
    DOCS.mkdir(
        parents=True,
        exist_ok=True
    )

    if not CONFIG.exists():
        raise RuntimeError(
            "Missing MASTER V5 config: " +
            str(CONFIG)
        )

    download(
        PLAYLIST_URL,
        RAW_M3U
    )

    wanted_ids = clean_playlist()

    download(
        EPG_URL,
        EPG_GZ
    )

    build_epg(wanted_ids)

    EPG_GZ.unlink(
        missing_ok=True
    )

    RAW_M3U.unlink(
        missing_ok=True
    )

    print()
    print("LOUNGE MASTER V5 CLOUD FEEDS READY")
    print(CLEAN_M3U)
    print(EPG_OUT)


if __name__ == "__main__":
    main()
