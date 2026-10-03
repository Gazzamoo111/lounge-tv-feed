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
SECURE_M3U = DOCS / "lounge-secure.m3u"
MISSING_OUT = DOCS / "master-v5-missing.txt"
EPG_GZ = DOCS / "epg6.xml.gz"
EPG_OUT = DOCS / "epg6-live.xml"

ATTR_RE = re.compile(r'([\w-]+)="([^"]*)"')


def download(url, path):
    print("Downloading:", url)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "LoungeTV/0.4.51"}
    )

    with urllib.request.urlopen(req, timeout=180) as response:
        with open(path, "wb") as f:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)

    print("Downloaded:", path, path.stat().st_size, "bytes")




def extinf_name(line):
    quoted = False
    escaped = False

    for i, ch in enumerate(line):
        if ch == "\\" and not escaped:
            escaped = True
            continue

        if ch == '"' and not escaped:
            quoted = not quoted
        elif ch == "," and not quoted:
            return line[i + 1:].strip()

        escaped = False

    return ""

def attrs(line):
    return {
        k.lower(): v
        for k, v in ATTR_RE.findall(line)
    }


def esc_attr(value):
    # M3U attributes are not XML. Escaping & as &amp; breaks
    # Lounge rail/category matching (e.g. HBO & Cinemax, 24/7).
    return (
        str(value or "")
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
                    "name": extinf_name(pending),
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
    if rec.get("reliability") is not None:
        a["lounge-reliability"] = rec.get("reliability")
    a["lounge-tier"] = rec.get("tier", "")
    a["lounge-network"] = rec.get("network", "")
    a["lounge-collections"] = ",".join(rec.get("collections") or [])

    preferred = [
        "tvg-id","tvg-name","tvg-logo","group-title","cuid",
        "lounge-original-name","lounge-category","lounge-rail",
        "lounge-layer","lounge-role","lounge-root-cuid",
        "lounge-backups","lounge-status","lounge-reliability","lounge-tier",
        "lounge-network","lounge-collections"
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
    secure_out = ["#EXTM3U"]
    ids = set()

    # secure_kept = every matched MASTER record.
    # public_kept = customer-visible catalogue rows only.
    secure_kept = 0
    public_kept = 0

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

        extinf = make_extinf(item, rec)

        # -------------------------------------------------
        # SECURE / INTERNAL PLAYLIST
        #
        # Keep every matched MASTER record here, including
        # hidden backup sources required for source failover.
        # -------------------------------------------------
        secure_out.append(extinf)
        secure_out.append(
            "lounge://channel/" + cuid + "?source=" + cuid
        )

        secure_kept += 1

        # -------------------------------------------------
        # CUSTOMER PLAYLIST
        #
        # Only expose visible, non-backup logical channels.
        # Hidden backup records remain available internally
        # through lounge-secure.m3u.
        # -------------------------------------------------
        role = str(rec.get("role", "primary")).strip().lower()
        visible = rec.get("visible", True)

        is_public = (
            visible is not False
            and role != "backup"
        )

        if not is_public:
            continue

        out.append(extinf)
        out.append(item["url"])

        public_kept += 1

        layer = str(rec.get("layer", "other"))
        layers[layer] = layers.get(layer, 0) + 1

        # EPG should represent customer-visible logical
        # channels, not hidden backup source rows.
        tvg_id = item["attrs"].get("tvg-id", "").strip()

        if not tvg_id:
            tvg_id = str(rec.get("tvg_id", "")).strip()

        if tvg_id:
            ids.add(tvg_id)

    if secure_kept < 900:
        raise RuntimeError(
            "Safety stop: fewer than 900 MASTER V5 rows matched upstream: " +
            str(secure_kept)
        )

    if secure_kept > 10000:
        raise RuntimeError(
            "Safety stop: MASTER V5 secure output unexpectedly large: " +
            str(secure_kept)
        )

    if public_kept < 900:
        raise RuntimeError(
            "Safety stop: customer-visible output unexpectedly small: " +
            str(public_kept)
        )

    CLEAN_M3U.write_text(
        "\n".join(out) + "\n",
        encoding="utf-8"
    )

    SECURE_M3U.write_text(
        "\n".join(secure_out) + "\n",
        encoding="utf-8"
    )

    if sum(1 for line in secure_out if line.startswith("#EXTINF:")) != secure_kept:
        raise RuntimeError("Safety stop: secure playlist row count drift")

    if sum(1 for line in out if line.startswith("#EXTINF:")) != public_kept:
        raise RuntimeError("Safety stop: customer playlist row count drift")

    MISSING_OUT.write_text(
        "\n".join(missing) + ("\n" if missing else ""),
        encoding="utf-8"
    )

    print("MASTER V5 requested:", len(wanted))
    print("MASTER V5 matched:", secure_kept)
    print("MASTER V5 missing:", len(missing))
    print("Customer-visible rows:", public_kept)
    print("Hidden/internal rows:", secure_kept - public_kept)
    print("Layer counts:", layers)
    print("EPG IDs:", len(ids))
    print("Secure rows:", secure_kept)

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
    end_window = now + timedelta(hours=30)

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
    print(SECURE_M3U)
    print(EPG_OUT)


if __name__ == "__main__":
    main()
