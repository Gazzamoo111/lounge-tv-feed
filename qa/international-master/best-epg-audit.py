#!/usr/bin/env python3
"""BEST XMLTV identity/coverage audit, isolated from Lounge TV production.

This reads the full feed on a GitHub-hosted runner instead of a memory-limited
Supabase Edge Function. It stores NO programme titles and never prints secrets.
Writes are optional, QA-only metadata, and subject to a DB-size safety gate.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import gzip
import io
import json
import os
import re
import sys
import unicodedata
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

SOURCE = "BEST"
COUNTRY = "master"
MAX_XML_BYTES = 1024 * 1024 * 1024
MAX_PERSIST_DB_BYTES = 494 * 1024 * 1024
STAMP = re.compile(r"^(\d{12})(\d{2})?\s*([+-]\d{4})")
PREFIX = re.compile(r"^(?:[A-Z]{2,5}\s*[\|:]\s*)+", re.I)
SUFFIX = re.compile(r"(?:\s+(?:FHD|FULL HD|HD|UHD|4K|HEVC|H265|H264))+$", re.I)


def norm(value):
    value = unicodedata.normalize("NFKD", (value or "").strip())
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = PREFIX.sub("", value)
    value = SUFFIX.sub("", value)
    value = value.casefold().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "", value)


def xmltv_time(value):
    m = STAMP.match(value or "")
    if not m:
        return None
    try:
        return datetime.strptime(
            m.group(1) + (m.group(2) or "00") + " " + m.group(3),
            "%Y%m%d%H%M%S %z",
        ).astimezone(timezone.utc)
    except ValueError:
        return None


class BoundedReader:
    def __init__(self, wrapped, limit=MAX_XML_BYTES):
        self.wrapped = wrapped
        self.limit = limit
        self.size = 0

    def read(self, n=-1):
        data = self.wrapped.read(n)
        self.size += len(data)
        if self.size > self.limit:
            raise ValueError("xmltv_uncompressed_size_cap")
        return data


class PrependReader:
    def __init__(self, prefix, wrapped):
        self.prefix, self.wrapped = prefix, wrapped

    def read(self, n=-1):
        if n < 0:
            data, self.prefix = self.prefix, b""
            return data + self.wrapped.read()
        data, self.prefix = self.prefix[:n], self.prefix[n:]
        if len(data) < n:
            return data + self.wrapped.read(n - len(data))
        return data


def open_xmltv(raw, content_encoding=""):
    first = raw.read(2)
    stream = PrependReader(first, raw)
    if first == b"\x1f\x8b" or content_encoding.lower() == "gzip":
        stream = gzip.GzipFile(fileobj=stream)
    return BoundedReader(stream)


def load_selection(db_url, selected_path):
    if selected_path:
        with open(selected_path, encoding="utf-8") as f:
            return json.load(f), None
    if not db_url:
        raise ValueError("qa_database_url_required")
    import psycopg
    conn = psycopg.connect(db_url, connect_timeout=15)
    with conn.cursor() as cur:
        cur.execute("""
          SELECT s.provider_stream_id, s.epg_channel_id, s.original_name
          FROM lounge_sync.international_master_selection_qa_20261119 chosen
          JOIN lounge_sync.international_master_streams_qa_20261119 s
            USING(provider_stream_id)
          WHERE chosen.tier='primary'
            AND NULLIF(s.epg_channel_id,'') IS NOT NULL
            AND s.epg_channel_id <> '0'
        """)
        rows = [{"stream_id": str(a), "epg_id": b, "name": c}
                for a, b, c in cur.fetchall()]
    return rows, conn


def audit_xmltv(source, selection, now=None):
    now = now or datetime.now(timezone.utc)
    until = now + timedelta(days=7)
    selected = defaultdict(list)
    for row in selection:
        epg_id = str(row.get("epg_id") or "").strip()
        if epg_id and epg_id != "0":
            selected[epg_id].append(row)
    found = {}
    counts = defaultdict(int)
    latest = {}
    tags = {"channel": 0, "programme": 0}
    root = None
    for event, elem in ET.iterparse(source, events=("start", "end")):
        if root is None and event == "start":
            if elem.tag != "tv":
                raise ValueError("invalid_xmltv_root")
            root = elem
            continue
        if event != "end":
            continue
        if elem.tag == "channel":
            tags["channel"] += 1
            epg_id = elem.get("id", "")
            if epg_id in selected:
                names = [n.text or "" for n in elem.findall("display-name")]
                found[epg_id] = next((x for x in names if x.strip()), "")
            root.clear()
        elif elem.tag == "programme":
            tags["programme"] += 1
            epg_id = elem.get("channel", "")
            if epg_id in selected:
                start = xmltv_time(elem.get("start"))
                stop = xmltv_time(elem.get("stop"))
                if start and stop and stop > now and start < until and stop > start:
                    counts[epg_id] += 1
                    if stop > latest.get(epg_id, now):
                        latest[epg_id] = stop
            root.clear()
    if root is None:
        raise ValueError("missing_xmltv_root")

    accepted, conflicting, missing, no_programmes = [], [], [], []
    for epg_id, rows in selected.items():
        if epg_id not in found:
            missing.extend(rows)
            continue
        actual = norm(found[epg_id])
        for row in rows:
            record = {"stream_id": str(row["stream_id"]), "epg_id": epg_id}
            if not actual or norm(row.get("name")) != actual:
                conflicting.append(record)
            elif not counts[epg_id]:
                no_programmes.append(record)
            else:
                accepted.append(record)
    summary = {
        "selected_sources_with_id": sum(len(rows) for rows in selected.values()),
        "selected_distinct_epg_ids": len(selected),
        "xmltv_channel_tags": tags["channel"],
        "xmltv_programme_tags": tags["programme"],
        "guide_ids_present": len(found),
        "guide_ids_with_current_programmes": sum(1 for i in found if counts[i]),
        "accepted_identity_and_current_programmes": len(accepted),
        "held_identity_conflict": len(conflicting),
        "held_missing_programmes": len(no_programmes),
        "not_found_in_guide": len(missing),
        "identity_matches_are_not_player_playback_proof": True,
        "programme_titles_stored": False,
    }
    metadata = [(epg_id, found[epg_id], counts[epg_id],
                 latest[epg_id]) for epg_id in found if found[epg_id]]
    return summary, metadata


def persist_metadata(conn, summary, metadata):
    if conn is None:
        raise ValueError("database_connection_required")
    with conn.cursor() as cur:
        cur.execute("SELECT pg_database_size(current_database())")
        db_size = cur.fetchone()[0]
        if db_size >= MAX_PERSIST_DB_BYTES:
            raise ValueError("free_tier_database_safety_gate")
        if len(metadata) > 20000:
            raise ValueError("metadata_limit_exceeded")
        cur.execute("""
          DELETE FROM lounge_sync.international_epg_source_channels_qa_20261119
          WHERE source_key=%s AND country_code=%s
        """, (SOURCE, COUNTRY))
        cur.executemany("""
          INSERT INTO lounge_sync.international_epg_source_channels_qa_20261119
            (source_key,country_code,xmltv_id,display_name,
             upcoming_programmes,latest_stop_utc,sampled_at)
          VALUES (%s,%s,%s,%s,%s,%s,now())
          ON CONFLICT (source_key,country_code,xmltv_id) DO UPDATE SET
            display_name=EXCLUDED.display_name,
            upcoming_programmes=EXCLUDED.upcoming_programmes,
            latest_stop_utc=EXCLUDED.latest_stop_utc,
            sampled_at=now()
        """, [(SOURCE, COUNTRY, a, b, c, d) for a,b,c,d in metadata])
        cur.execute("""
          INSERT INTO lounge_sync.international_epg_source_checks_qa_20261119
          (source_key,country_code,http_status,scanned_channels,
           with_upcoming,bytes_processed,status,notes)
          VALUES (%s,%s,200,%s,%s,0,'complete',%s)
          ON CONFLICT(source_key,country_code) DO UPDATE SET
            checked_at=now(),http_status=EXCLUDED.http_status,
            scanned_channels=EXCLUDED.scanned_channels,
            with_upcoming=EXCLUDED.with_upcoming,
            bytes_processed=EXCLUDED.bytes_processed,
            status=EXCLUDED.status,notes=EXCLUDED.notes
        """, (SOURCE, COUNTRY, len(metadata),
              sum(1 for a,b,c,d in metadata if c > 0),
              "Python runner: metadata only; programme titles not stored"))
    conn.commit()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--fixture", help="Local XMLTV or .gz fixture instead of BEST")
    p.add_argument("--selected", help="Local JSON selection fixture instead of QA DB")
    p.add_argument("--persist", action="store_true", help="Write only QA source metadata")
    p.add_argument("--out", default="best-epg-qa-summary.json")
    args = p.parse_args()
    db_url = os.getenv("QA_DATABASE_URL", "")
    selection, conn = load_selection(db_url, args.selected)
    try:
        if args.fixture:
            with open(args.fixture, "rb") as raw:
                result, metadata = audit_xmltv(open_xmltv(raw), selection)
        else:
            link = os.environ.get("BEST_XMLTV_URL", "")
            parts = urlsplit(link)
            if parts.scheme not in ("https", "http") or not parts.netloc:
                raise ValueError("best_xmltv_url_missing_or_invalid")
            if parts.scheme != "https" and os.getenv("ALLOW_HTTP_XMLTV") != "1":
                raise ValueError("plaintext_provider_url_refused")
            req = Request(link, headers={"Accept": "application/xml,text/xml,application/gzip,*/*",
                                         "User-Agent": "LoungeTV-EPG-QA-Audit/1.0"})
            with urlopen(req, timeout=60) as response:
                if response.status != 200:
                    raise ValueError("provider_http_failure")
                result, metadata = audit_xmltv(
                    open_xmltv(response, response.headers.get("Content-Encoding", "")),
                    selection)
        if args.persist:
            persist_metadata(conn, result, metadata)
        result["qa_metadata_persisted"] = bool(args.persist)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, sort_keys=True)
        print(json.dumps(result, sort_keys=True))
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:
        # Never print traceback containing provider credential URLs or DB DSNs.
        print("QA audit failed: " + type(ex).__name__ + " (secrets redacted)", file=sys.stderr)
        sys.exit(1)
