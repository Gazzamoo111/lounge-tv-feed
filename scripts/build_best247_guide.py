#!/usr/bin/env python3
"""Refresh the credential-free BEST 24/7 title-level XMLTV guide."""
import argparse
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "config/best247_channel_index.json"
CACHE = ROOT / "config/best247_synopses.json"
GUIDE = ROOT / "docs/best-247-guide.xml"

def clean_title(value):
    name = str(value or "").strip()
    name = re.sub(r"^[A-Z]{2}\s*\|\s*", "", name)
    name = re.sub(r"^24\s*/\s*7\s*[-:|]?\s*", "", name, flags=re.I)
    name = re.sub(r"^ONEPLAY\s*[-:|]?\s*", "", name, flags=re.I)
    name = re.sub(r"[ᴿᴬᵂ⁶⁰ᶠᵖˢᴴᴰᵁᶠ]", "", name)
    name = re.sub(r"\b(?:FHD|UHD|HD|SD|1080P|4K)\b", "", name, flags=re.I)
    return re.sub(r"\s+", " ", name).strip(" -|") or str(value)

def key(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value).casefold()).strip()

def basic_description(title):
    return (f"Continuous 24/7 programming dedicated to {title}. "
            "BEST has not supplied a verified schedule of individual episodes or movies.")

def load_cache():
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    cache = {}
    if GUIDE.exists():
        for event, elem in ET.iterparse(GUIDE, events=("end",)):
            if elem.tag != "programme":
                continue
            title = elem.findtext("title") or ""
            desc = elem.findtext("desc") or ""
            if title and desc and not desc.startswith((
                    "Continuous 24/7 programming", "A continuous 24/7 channel")):
                cache.setdefault(key(title), {"synopsis": desc, "source": "curated"})
            elem.clear()
    return cache

def candidate(title):
    if not (3 <= len(title) <= 70):
        return False
    if re.search(r"\b(?:premiere|sports?|sky store|netflix|epg|test|info|backup|action|adventure|channel|movies?|comedy|drama|classics|best of)\s*\d*\b", title, re.I):
        return False
    if re.search(r"\d+$", title) and not re.search(r"\b\d{4}$", title):
        return False
    return True

def lookup_tvmaze(title):
    url = "https://api.tvmaze.com/singlesearch/shows?q=" + urllib.parse.quote(title)
    req = urllib.request.Request(url, headers={"User-Agent": "LoungeTV-247-Guide/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            obj = json.load(response)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as err:
        if isinstance(err, urllib.error.HTTPError) and err.code == 404:
            return ""
        return None
    if key(obj.get("name", "")) != key(title):
        return ""
    raw = obj.get("summary") or ""
    desc = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    return re.sub(r"\s+", " ", desc).strip()[:800]

def run(enrich_limit):
    rows = json.loads(INDEX.read_text(encoding="utf-8"))["channels"]
    if len(rows) < 3000 or len({str(x["id"]) for x in rows}) != len(rows):
        raise RuntimeError("BEST 24/7 channel index incomplete or duplicate IDs")
    cache = load_cache()
    added = 0
    for title in sorted({clean_title(x["name"]) for x in rows}, key=str.casefold):
        k = key(title)
        if k in cache or not candidate(title) or added >= enrich_limit:
            continue
        result = lookup_tvmaze(title)
        if result is not None:
            cache[k] = {"synopsis": result, "source": "TVMaze" if result else "unmatched"}
            added += 1
        time.sleep(.7)
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    tv = ET.Element("tv", {
        "generator-info-name": "Lounge TV BEST 24/7 channel-title guide",
        "source-info-name": "BEST names, curated summaries and TVMaze; not live-episode identification",
    })
    for item in rows:
        eid = "best247." + str(item["id"])
        name = str(item["name"])
        title = clean_title(name)
        node = ET.SubElement(tv, "channel", {"id": eid})
        ET.SubElement(node, "display-name", {"lang": "en"}).text = name
        if name != title:
            ET.SubElement(node, "display-name", {"lang": "en"}).text = title

    first_day = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=1)
    windows = [(first_day + timedelta(days=i * 3), first_day + timedelta(days=(i + 1) * 3))
               for i in range(6)]
    enriched_count = 0
    for item in rows:
        title = clean_title(item["name"])
        synopsis = (cache.get(key(title)) or {}).get("synopsis") or ""
        if synopsis:
            enriched_count += 1
        else:
            synopsis = basic_description(title)
        for start, stop in windows:
            p = ET.SubElement(tv, "programme", {
                "start": start.strftime("%Y%m%d%H%M%S +0000"),
                "stop": stop.strftime("%Y%m%d%H%M%S +0000"),
                "channel": "best247." + str(item["id"]),
            })
            ET.SubElement(p, "title", {"lang": "en"}).text = title
            ET.SubElement(p, "desc", {"lang": "en"}).text = synopsis
            ET.SubElement(p, "category", {"lang": "en"}).text = "24/7 programming"
    ET.indent(tv, space="  ")
    GUIDE.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(tv).write(GUIDE, encoding="utf-8", xml_declaration=True)
    n = sum(1 for _, node in ET.iterparse(GUIDE, events=("end",)) if node.tag == "programme")
    if n != len(rows) * len(windows):
        raise RuntimeError(f"Guide has wrong programme count: {n}")
    print(f"Guide ready: {len(rows)} channels, {n} programme blocks, "
          f"{enriched_count} descriptive synopses, {added} metadata lookups cached")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--enrich-limit", type=int, default=250)
    args = parser.parse_args()
    run(max(0, args.enrich_limit))
