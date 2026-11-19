#!/usr/bin/env python3
"""Build a *private QA-only* validated International XMLTV guide outside Supabase.

Input: OIDC-authenticated BEST and current shared guide, selected EPG identities.
Output: compressed XMLTV uploaded into private Supabase Storage via OIDC broker.
No programme content or subscriber credentials are written to the GitHub repo.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from urllib.request import Request, urlopen


AUDIT = Path(__file__).with_name("best-epg-audit.py")
spec = importlib.util.spec_from_file_location("best_epg", AUDIT)
best = importlib.util.module_from_spec(spec)
spec.loader.exec_module(best)

BROKER = "https://liqocisegeqzbyuqloql.supabase.co/functions/v1/loun" + "ge-international-epg-broker-qa"
OUT = Path("international-master.xml.gz")
MAX_COMPRESSED = 49_000_000
MAX_XML_BYTES = 550 * 1024 * 1024


def authenticated_request(endpoint, data=None, content_type=None):
    token = os.environ.get("LOUNGE_QA_OIDC", "").strip()
    if not token or token.count(".") != 2:
        raise ValueError("GitHub OIDC token required")
    headers = {"Authorization": "Bearer " + token, "Accept": "application/xml, application/json"}
    if content_type:
        headers["Content-Type"] = content_type
    return Request(BROKER + "/" + endpoint, data=data, headers=headers,
                   method="PUT" if data is not None else "GET")


def index_selection():
    with urlopen(authenticated_request("selection"), timeout=45) as response:
        if response.status != 200:
            raise ValueError("selection unavailable")
        raw = response.read(3_000_000)
        selection = json.loads(raw)
        if not isinstance(selection, list) or not 1000 <= len(selection) <= 50000:
            raise ValueError("selected index size invalid")
    chosen = defaultdict(set)
    id_counts = defaultdict(int)
    for row in selection:
        epg_id = str(row.get("epg_id") or "").strip()
        if epg_id and epg_id != "0":
            chosen[epg_id].add(best.norm(row.get("name") or ""))
            id_counts[epg_id] += 1
    return chosen, id_counts


def stream_parsed(source):
    # Handles both XMLTV and .gz returned by upstream (without full buffering).
    wrapped = best.open_xmltv(source)
    wrapped.limit = MAX_XML_BYTES
    events = ET.iterparse(wrapped, events=("start", "end"))
    root = None
    for event, elem in events:
        if root is None and event == "start":
            if elem.tag != "tv":
                raise ValueError("not an XMLTV feed")
            root = elem
            continue
        if event != "end":
            continue
        if elem.tag in ("channel", "programme"):
            yield elem
            root.clear()


def has_current_programme(elem, now, horizon):
    if elem.find("title") is None:
        return False
    title = elem.find("title")
    if not (title.text or "").strip():
        return False
    start = best.xmltv_time(elem.get("start"))
    stop = best.xmltv_time(elem.get("stop"))
    return bool(start and stop and stop > now-timedelta(minutes=60) and
                start <= horizon and stop > start)


def build():
    selected, id_counts = index_selection()
    if len(selected) < 500:
        raise ValueError("incomplete selected guide IDs")
    current = datetime.now(timezone.utc)
    horizon = current + timedelta(days=7)
    confirmed = set()
    provider_programs = defaultdict(int)
    shared_programs = defaultdict(int)
    stats = {"selected_id_count": len(selected), "selected_source_entries": sum(id_counts.values()),
             "provider_channel_tags": 0, "provider_programme_tags": 0,
             "shared_channel_tags": 0, "shared_programme_tags": 0}
    with gzip.open(OUT, "wb", compresslevel=6) as out:
        out.write(b'<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="Lounge TV International QA">\n')
        with urlopen(authenticated_request("best"), timeout=140) as response:
            if response.status != 200:
                raise ValueError("BEST guide request failed")
            for elem in stream_parsed(response):
                if elem.tag == "channel":
                    stats["provider_channel_tags"] += 1
                    cid = elem.get("id", "")
                    if cid in selected:
                        names = [best.norm(n.text or "") for n in elem.findall("display-name")]
                        if any(n and n in selected[cid] for n in names):
                            confirmed.add(cid)
                            out.write(ET.tostring(elem, encoding="utf-8") + b"\n")
                else:
                    stats["provider_programme_tags"] += 1
                    cid = elem.get("channel", "")
                    if cid in confirmed and has_current_programme(elem, current, horizon):
                        provider_programs[cid] += 1
                        out.write(ET.tostring(elem, encoding="utf-8") + b"\n")
        # The current shared guide preserves NZ/AU and known accurate channels.
        # Only supplement IDs where the verified BEST feed has no programmes.
        with urlopen(authenticated_request("shared"), timeout=140) as response:
            if response.status != 200:
                raise ValueError("shared XMLTV request failed")
            for elem in stream_parsed(response):
                if elem.tag == "channel":
                    stats["shared_channel_tags"] += 1
                    cid = elem.get("id", "")
                    if not provider_programs.get(cid):
                        out.write(ET.tostring(elem, encoding="utf-8") + b"\n")
                else:
                    stats["shared_programme_tags"] += 1
                    cid = elem.get("channel", "")
                    if not provider_programs.get(cid) and has_current_programme(elem, current, horizon):
                        shared_programs[cid] += 1
                        out.write(ET.tostring(elem, encoding="utf-8") + b"\n")
        out.write(b"</tv>\n")
    size = OUT.stat().st_size
    unique_ids = set(provider_programs) | set(shared_programs)
    stats.update({
        "best_confirmed_channel_ids": len(confirmed),
        "best_current_programme_channels": len(provider_programs),
        "best_current_programmes": sum(provider_programs.values()),
        "shared_fallback_programme_channels": len(shared_programs),
        "shared_fallback_programmes": sum(shared_programs.values()),
        "distinct_current_programme_ids": len(unique_ids),
        "gzip_bytes": size,
        "programme_schedules_persisted_to_postgres": False,
        "stream_playback_tested": False,
    })
    # Fail closed rather than replacing an existing guide with an empty artifact.
    if len(unique_ids) < 400 or sum(provider_programs.values()) < 100:
        raise ValueError("guide QA threshold not satisfied")
    if size <= 200 or size > MAX_COMPRESSED:
        raise ValueError("compressed XMLTV size outside limits")
    with gzip.open(OUT, "rb") as guide:
        count = sum(1 for _, elem in ET.iterparse(guide, events=("end",))
                    if elem.tag == "programme")
    if count != sum(provider_programs.values())+sum(shared_programs.values()):
        raise ValueError("output verification count mismatch")
    Path("international-epg-metrics-qa.json").write_text(
        json.dumps(stats, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(stats, sort_keys=True))


def upload():
    if not OUT.is_file():
        raise ValueError("compressed XMLTV file missing")
    data = OUT.read_bytes()
    if not (200 < len(data) <= MAX_COMPRESSED):
        raise ValueError("invalid upload size")
    with urlopen(authenticated_request("upload", data, "application/gzip"), timeout=120) as response:
        result = json.load(response)
        if not result.get("stored"):
            raise ValueError("private QA Storage upload not confirmed")
    with urlopen(authenticated_request("status"), timeout=30) as response:
        result = json.load(response)
        if not result.get("stored"):
            raise ValueError("private QA Storage verification failed")
    print(json.dumps({"private_storage_confirmed":True,
                      "uploaded_bytes":len(data),
                      "storage_bytes":result.get("bytes")}, sort_keys=True))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=("build", "upload"))
    args = p.parse_args()
    try:
        (build if args.action == "build" else upload)()
    except Exception as exc:
        # Never print credential-bearing URLs or bearer tokens in logs.
        print("International EPG QA " + args.action + " failed: " +
              type(exc).__name__ + " (details redacted)", file=sys.stderr)
        sys.exit(1)
