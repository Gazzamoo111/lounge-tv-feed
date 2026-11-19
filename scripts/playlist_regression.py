"""Validate and compare offline Lounge TV feeds or project a private QA export."""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html import unescape
import hashlib
import json
from itertools import zip_longest
import os
from pathlib import Path
import re
from urllib.parse import urlsplit
from xml.etree import ElementTree

ATTR = re.compile(r'([\w-]+)="([^"]*)"')
ENTITY = re.compile(r"&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);", re.I)
UNSCHEDULED = re.compile(r"\b(?:24/7|live events|sports event sources|ppv)\b", re.I)
FALLBACK = "nuvio_m3u_drm_fallback_required"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def strict_json(path):
    def object_pairs(pairs):
        result = dict(pairs)
        require(len(result) == len(pairs), "JSON has duplicate object keys")
        return result

    def reject_constant(_):
        raise ValueError("JSON has a non-finite value")

    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=object_pairs,
                      parse_constant=reject_constant)


def identifier(value):
    return isinstance(value, (str, int)) and not isinstance(value, bool) and bool(
        re.fullmatch(r"[\w.:-]{1,160}", str(value))
    )


def clean_label(value):
    return isinstance(value, str) and bool(value.strip()) and not ENTITY.search(value) and not (
        re.search(r"://|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|[\x00-\x1f]", value, re.I)
    )


def http_url(value):
    parsed = urlsplit(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.hostname)


def asset_marker(value, synthetic):
    if synthetic and value:
        # Record synthetic icon changes without keeping any part of a URL.
        parsed = urlsplit(value)
        return hashlib.sha256(f"{parsed.hostname}{parsed.path}".encode()).hexdigest()[:16]
    return bool(value)


def parse_m3u(path, synthetic=False):
    rows = []
    pending = None
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    require(lines and re.fullmatch(r"#EXTM3U(?:\s.*)?", lines[0]), "Missing extended M3U header")
    for number, line in enumerate(lines[1:], 2):
        line = line.strip()
        if not line:
            continue
        if line.startswith("#EXTINF:"):
            require(pending is None, f"M3U line {number}: previous channel has no stream")
            match = re.fullmatch(r'#EXTINF:(-?\d+(?:\.\d+)?)((?:\s+[\w-]+="[^"]*")*),(.*)', line)
            require(match, f"M3U line {number}: invalid EXTINF")
            attributes = ATTR.findall(match[2])
            attrs = dict(attributes)
            require(len(attrs) == len(attributes), f"M3U line {number}: duplicate attribute")
            name, group = match[3].strip(), unescape(attrs.get("group-title", ""))
            logo = unescape(attrs.get("tvg-logo", ""))
            group_icon = unescape(attrs.get("group-logo", ""))
            require(clean_label(name) and clean_label(group), f"M3U line {number}: invalid channel or group label")
            channel_id = attrs.get("channel-id", "")
            epg = unescape(attrs.get("tvg-id", ""))
            require(identifier(channel_id) and (not epg or identifier(epg)), f"M3U line {number}: invalid channel or guide ID")
            require(not logo or http_url(logo), f"M3U line {number}: invalid logo URL")
            require(not group_icon or http_url(group_icon), f"M3U line {number}: invalid group icon URL")
            pending = {"id": channel_id, "name": name, "group": group, "epg": epg,
                       "logo": asset_marker(logo, synthetic), "group_icon": asset_marker(group_icon, synthetic), "drm": False}
        elif line.startswith("#KODIPROP:inputstream.adaptive.license_type="):
            require(pending is not None, f"M3U line {number}: orphan DRM property")
            pending["drm"] = line.partition("=")[2] == "com.widevine.alpha"
        elif not line.startswith("#"):
            require(pending is not None and http_url(line), f"M3U line {number}: invalid stream entry")
            pending["transport"] = {
                ".mpd": "dash", ".m3u8": "hls", ".ts": "ts",
            }.get(Path(urlsplit(line).path).suffix.lower(), "other")
            rows.append(pending)
            pending = None
    require(rows and pending is None, "Empty or incomplete M3U")
    require(len({row["id"] for row in rows}) == len(rows), "M3U repeats a stable channel ID")
    return rows


def parse_xtream(categories, streams, status, rows, synthetic=False):
    require(isinstance(categories, list) and categories, "Expected non-empty Xtream category list")
    groups = []
    by_id = {}
    for item in categories:
        require(isinstance(item, dict) and identifier(item.get("category_id")) and
                clean_label(item.get("category_name")), "Invalid Xtream category")
        key = str(item["category_id"])
        name = item["category_name"]
        require(key not in by_id, "Duplicate Xtream category ID")
        by_id[key] = name
        icon = item.get("category_icon", "")
        require(isinstance(icon, str) and (not icon or http_url(icon)), "Invalid Xtream category icon")
        groups.append({"id": key, "name": name, "icon": asset_marker(icon, synthetic)})
    require(len(set(by_id.values())) == len(by_id), "Duplicate Xtream category label")
    m3u_groups = list(dict.fromkeys(row["group"] for row in rows))
    require(m3u_groups == list(by_id.values()), "M3U and Xtream category names or order differ")
    if status == 503:
        require(isinstance(streams, dict) and streams.get("error") == FALLBACK,
                "Xtream 503 did not return the documented DRM fallback code")
        return groups, "503 " + FALLBACK
    require(status == 200 and isinstance(streams, list) and streams, "Invalid Xtream live stream response")
    projected = []
    for row in streams:
        require(isinstance(row, dict) and identifier(row.get("stream_id")) and
                str(row["stream_id"]).isdigit() and clean_label(row.get("name")), "Invalid Xtream stream identity")
        group = by_id.get(str(row.get("category_id")))
        epg = row.get("epg_channel_id") or ""
        icon = row.get("stream_icon", "")
        require(group is not None and (not epg or identifier(epg)), "Invalid Xtream channel category or guide ID")
        require(isinstance(icon, str) and (not icon or http_url(icon)), "Invalid Xtream stream icon")
        projected.append(("ltv-" + str(row["stream_id"]), row["name"], group, epg, asset_marker(icon, synthetic)))
    require(len({row[0] for row in projected}) == len(projected), "Duplicate Xtream stream ID")
    require(projected == [(row["id"], row["name"], row["group"], row["epg"], row["logo"]) for row in rows],
            "Xtream and M3U channel IDs, order, display metadata or mappings differ")
    return groups, "200 live catalogue"


def programme_time(value):
    require(re.fullmatch(r"\d{14}\s[+-](?:[01]\d|2[0-3])[0-5]\d", value or ""),
            "XMLTV timestamp needs a full date and explicit numeric offset")
    return datetime.strptime(value, "%Y%m%d%H%M%S %z").astimezone(timezone.utc)


def xml_events(path):
    # ElementTree does not fetch external entities. Refuse internal DTD subsets
    # as well, while accepting the common XMLTV external DTD declaration.
    with path.open("rb") as source:
        first = source.read(8192)
        require(b"\0" not in first, "XMLTV must be a UTF-8 feed")
        carry = b""
        chunk = first
        while chunk:
            require(not re.search(rb"<!ENTITY|<!DOCTYPE(?:(?!>).)*\[", carry + chunk, re.I | re.S),
                    "XMLTV internal DTD or entity declaration")
            carry = (carry + chunk)[-1024:]
            chunk = source.read(8192)
        source.seek(0)
        yield from ElementTree.iterparse(source, events=("start", "end"))


def coverage(path, rows, as_of):
    ids = set()
    valid = defaultdict(list)
    referenced = set()
    invalid_timestamps = invalid_ids = 0
    root = None
    depth = 0
    for event, item in xml_events(path):
        if event == "start":
            depth += 1
            if depth == 1:
                root = item
                require(root.tag == "tv", "XMLTV root must be tv")
            continue
        if depth == 2:
            if item.tag == "channel":
                epg_id = item.get("id")
                if not identifier(epg_id) or epg_id in ids:
                    invalid_ids += 1
                else:
                    ids.add(epg_id)
            elif item.tag == "programme":
                epg_id = item.get("channel")
                referenced.add(epg_id)
                try:
                    start = programme_time(item.get("start"))
                    stop = programme_time(item.get("stop"))
                    require(start < stop, "Programme stop must follow start")
                except ValueError:
                    invalid_timestamps += 1
                else:
                    valid[epg_id].append((start, stop))
            else:
                raise ValueError("Unexpected XMLTV element under tv")
            root.remove(item)
        depth -= 1
    eligible = [row for row in rows if not UNSCHEDULED.search(row["group"])]
    mapped = [row for row in eligible if row["epg"] in ids]
    windows = {}
    for row in mapped:
        intervals = valid[row["epg"]]
        current = max((span for span in intervals if span[0] <= as_of < span[1]), default=None)
        upcoming = min((span for span in intervals if span[0] > as_of), default=None)
        windows[row["id"]] = {
            "current": [time.isoformat() for time in current] if current else None,
            "next": [time.isoformat() for time in upcoming] if upcoming else None,
        }
    return {
        "eligible": len(eligible), "excluded_unscheduled": len(rows) - len(eligible),
        "mapped": len(mapped), "current": sum(bool(window["current"]) for window in windows.values()),
        "next": sum(bool(window["next"]) for window in windows.values()),
        "no_epg_id": [row["id"] for row in eligible if row["epg"] in {"", row["id"]} and row["epg"] not in ids],
        "missing_xmltv_id": [row["id"] for row in eligible if row["epg"] not in ids | {"", row["id"]}],
        "invalid_xmltv_ids": invalid_ids + len(referenced - ids), "invalid_timestamps": invalid_timestamps,
        "windows": windows,
    }


def duplicate_analysis(rows, annotations):
    by_provider = defaultdict(list)
    by_name = defaultdict(list)
    for row in rows:
        annotation = annotations.get(row["id"], {})
        require(isinstance(annotation, dict), "Invalid duplicate annotation")
        provider = annotation.get("provider")
        region = annotation.get("region", "")
        identity = annotation.get("identity", row["name"])
        require((provider is None or identifier(provider)) and (not region or clean_label(region)) and
                clean_label(identity), "Invalid provider, region or logical channel annotation")
        if provider is not None:
            by_provider[str(provider)].append(row["id"])
        identity = re.sub(r"\b(?:SD|HD|FHD|UHD|4K|HEVC|1080P|720P)\b", "", identity, flags=re.I)
        identity = " ".join(re.findall(r"\w+", identity.casefold()))
        by_name[identity].append((row["id"], region.casefold(), row["group"]))
    result = {"duplicate_provider_ids": [], "duplicates": [], "regional_variants": [], "review": []}
    result["duplicate_provider_ids"] = sorted(ids for ids in by_provider.values() if len(ids) > 1)
    for candidates in by_name.values():
        if len(candidates) < 2:
            continue
        ids, regions, groups = zip(*candidates)
        if all(regions) and len(set(regions)) == len(regions):
            kind = "regional_variants"
        elif all(regions) and len(set(regions)) < len(regions):
            kind = "duplicates"
        elif any(regions) or len(set(groups)) > 1 or any(UNSCHEDULED.search(group) for group in groups):
            kind = "review"
        else:
            kind = "duplicates"
        result[kind].append(list(ids))
    return result


def project(directory, profile, as_of, stream_status, provenance):
    synthetic = provenance == "synthetic"
    rows = parse_m3u(directory / "playlist.m3u", synthetic)
    groups, xtream = parse_xtream(strict_json(directory / "categories.json"),
                                  strict_json(directory / "streams.json"), stream_status, rows, synthetic)
    annotations_path = directory / "identities.json"
    annotations = strict_json(annotations_path) if annotations_path.is_file() else {}
    require(isinstance(annotations, dict) and all(identifier(key) for key in annotations),
            "Invalid duplicate annotations")
    guides = {"primary": coverage(directory / "guide.xml", rows, as_of)}
    if (directory / "fallback.xml").is_file():
        guides["fallback"] = coverage(directory / "fallback.xml", rows, as_of)
    return {
        "schema": 1, "profile": profile, "as_of": as_of.isoformat(), "provenance": provenance,
        "xtream": xtream, "groups": groups, "counts": dict(Counter(row["group"] for row in rows)),
        "channels": rows, "duplicates": duplicate_analysis(rows, annotations), "guides": guides,
    }


def differences(expected, actual):
    for key in ("schema", "profile", "as_of", "provenance", "xtream"):
        if expected[key] != actual[key]:
            yield f"{key} changed from {expected[key]} to {actual[key]}"
    if expected["groups"] != actual["groups"]:
        old_groups = [(group["id"], group["name"], group["icon"]) for group in expected["groups"]]
        new_groups = [(group["id"], group["name"], group["icon"]) for group in actual["groups"]]
        for index, (old, new) in enumerate(zip_longest(old_groups, new_groups), 1):
            if old != new:
                yield f"category {index} (ID, label, icon): {old} → {new}"
    for key in sorted(expected["counts"].keys() | actual["counts"].keys()):
        old, new = expected["counts"].get(key, 0), actual["counts"].get(key, 0)
        if old != new:
            yield f"{key}: channel count {old} → {new}"
    before, after = ({row["id"]: row for row in snapshot["channels"]} for snapshot in (expected, actual))
    if before.keys() != after.keys():
        yield f"stable IDs removed {sorted(before.keys() - after.keys())}, added {sorted(after.keys() - before.keys())}"
    if list(before) != list(after):
        index = next((i for i, pair in enumerate(zip(before, after), 1) if pair[0] != pair[1]),
                     min(len(before), len(after)) + 1)
        yield f"channel order or length changed at position {index}"
    for key in sorted(before.keys() & after.keys()):
        changed = [f"{field} {before[key][field]!r} → {after[key][field]!r}"
                   for field in before[key] if before[key][field] != after[key][field]]
        if changed:
            yield f"{key}: {', '.join(changed)}"
    for key in actual["duplicates"]:
        if expected["duplicates"][key] != actual["duplicates"][key]:
            yield f"{key}: {expected['duplicates'][key]} → {actual['duplicates'][key]}"
    for branch in sorted(expected["guides"].keys() | actual["guides"].keys()):
        if branch not in expected["guides"] or branch not in actual["guides"]:
            yield f"{branch}: guide branch added or removed"
            continue
        old, new = expected["guides"][branch], actual["guides"][branch]
        for key in sorted(new.keys() - {"windows"}):
            if old[key] != new[key]:
                yield f"{branch} {key}: {old[key]} → {new[key]}"
        changed = [key for key in sorted(old["windows"].keys() | new["windows"].keys())
                   if old["windows"].get(key) != new["windows"].get(key)]
        if changed:
            yield f"{branch} programme windows changed for: {', '.join(changed)}"


def check(snapshot):
    issues = []
    for kind in ("duplicate_provider_ids", "duplicates"):
        if snapshot["duplicates"][kind]:
            issues.append(f"{kind}: {snapshot['duplicates'][kind]}")
    for branch, report in snapshot["guides"].items():
        for key in ("invalid_xmltv_ids", "invalid_timestamps"):
            if report[key]:
                issues.append(f"{branch}: {report[key]} {key}")
    return issues


def summary(snapshot):
    for branch, report in snapshot["guides"].items():
        yield (f"{branch}: {report['mapped']}/{report['eligible']} mapped, {report['current']} current, "
               f"{report['next']} next, {len(report['no_epg_id'])} without guide ID, "
               f"{len(report['missing_xmltv_id'])} missing from XMLTV, {report['invalid_xmltv_ids']} invalid XMLTV IDs, "
               f"{report['invalid_timestamps']} invalid timestamps, {report['excluded_unscheduled']} unscheduled excluded")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--profile", choices=("nz-au", "plus", "regional-v4"), required=True)
    parser.add_argument("--as-of", required=True, help="ISO 8601 instant with UTC offset")
    parser.add_argument("--stream-status", required=True, type=int, choices=(200, 503))
    parser.add_argument("--revision", help="40-character source commit (private capture)")
    parser.add_argument("--origin-version", type=int, help="Observed Edge Function version (private capture)")
    parser.add_argument("--guide-branch", choices=("core", "provider-fallback", "compiled-private-qa", "selected-qa"),
                        help="Observed XMLTV response branch (private capture)")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--capture-private", type=Path, help="New local file with owner-only permissions")
    action.add_argument("--compare-synthetic", type=Path, help="Tracked deterministic fixture")
    args = parser.parse_args()
    try:
        as_of = datetime.fromisoformat(args.as_of)
        require(as_of.utcoffset() is not None, "Supply a comparison time with UTC offset")
        provenance = "private-authenticated" if args.capture_private else "synthetic"
        snapshot = project(args.directory, args.profile, as_of.astimezone(timezone.utc),
                           args.stream_status, provenance)
        issues = check(snapshot)
        if args.capture_private:
            require(re.fullmatch(r"[a-f0-9]{40}", args.revision or "") and
                    args.origin_version is not None and args.origin_version > 0 and args.guide_branch,
                    "Capture needs source revision, origin version and guide branch")
            aliases = {"nz-au": "n.loungetv.nz", "plus": "n.loungetv.nz", "regional-v4": None}
            slugs = {"nz-au": "n", "plus": "lounge-plus-qa", "regional-v4": "lounge-international-regional-qa"}
            snapshot["capture"] = {"public_alias": aliases[args.profile], "origin_slug": slugs[args.profile],
                                   "origin_version": args.origin_version, "source_revision": args.revision,
                                   "guide_branch": args.guide_branch}
            # Export a projection, never raw bodies, request data, URLs or programme titles.
            with open(os.open(args.capture_private, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600),
                      "w", encoding="utf-8") as destination:
                json.dump(snapshot, destination, ensure_ascii=False, indent=2)
                destination.write("\n")
        else:
            issues.extend(differences(strict_json(args.compare_synthetic), snapshot))
    except (OSError, KeyError, TypeError, ValueError, ElementTree.ParseError):
        if args.capture_private:
            parser.exit(1, "Capture failed: check the private export formats, source metadata, timestamp and destination.\n")
        raise
    print(f"{'FAIL' if issues else 'PASS'} {args.profile}: {len(snapshot['channels'])} channels, "
          f"{len(snapshot['groups'])} categories, Xtream {snapshot['xtream']}")
    for line in summary(snapshot):
        print("  " + line)
    if not args.capture_private:
        for issue in issues:
            print("  " + issue)
    return int(bool(issues))


if __name__ == "__main__":
    raise SystemExit(main())
