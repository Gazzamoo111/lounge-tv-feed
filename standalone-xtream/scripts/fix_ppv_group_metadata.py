#!/usr/bin/env python3
"""QA-only fix: one malformed event name embeds an extra ZZ group-title.

Run against a staging copy of the CURRENT deduplicated QA R2 catalog/ directory,
then validate and publish a new immutable QA release. This script NEVER writes
Cloudflare, production, Supabase or any playback URLs itself.
"""
import argparse
import json
import re
from pathlib import Path

STREAM_ID = 2189718
CATEGORY_NAME = '🏆 Live Sport | Events & PPV'
CLEAN_NAME = '2026: Las Vegas, Practice @ Nov 19 9:00 PM :Fubo US  12'
BAD_GROUP = 'ZZ | LIVE SPORTS EVENTS & PPV'
JSON_FILES = ('by-category/25.json', 'live_all.json')


def repair(catalog: Path, dry_run: bool = False) -> dict:
    files = (*JSON_FILES, 'template.m3u', 'live_categories.json')
    originals = {f: (catalog / f).read_text(encoding='utf-8') for f in files}
    categories = json.loads(originals['live_categories.json'])
    assert len(categories) == 25, 'Unexpected category count'
    assert categories[-1]['category_id'] == '25', 'Event pool must remain last'
    assert categories[-1]['category_name'] == CATEGORY_NAME, 'Unexpected event category'

    changed = {}
    for filename in JSON_FILES:
        raw = originals[filename]
        rows = json.loads(raw)
        targets = [r for r in rows if r.get('stream_id') == STREAM_ID]
        assert len(targets) == 1, f'{filename}: expected one matching event'
        old = targets[0]
        assert old['category_id'] == '25', 'Unexpected category assignment'
        assert old['name'] == CLEAN_NAME or (
            old['name'].startswith(CLEAN_NAME + '" tvg-logo="')
            and BAD_GROUP in old['name']
        ), 'Unrecognised event name; refuse to change'
        if old['name'] == CLEAN_NAME:
            changed[filename] = raw
            continue
        old_record = json.dumps(old, ensure_ascii=False, separators=(',', ':'))
        new_record = json.dumps({**old, 'name': CLEAN_NAME}, ensure_ascii=False, separators=(',', ':'))
        assert raw.count(old_record) == 1, 'Cannot replace precisely one record'
        updated = raw.replace(old_record, new_record, 1)
        new_rows = json.loads(updated)
        assert len(rows) == len(new_rows), 'Entry count changed'
        for before, after in zip(rows, new_rows):
            if before != after:
                assert before['stream_id'] == STREAM_ID
                assert {k: v for k, v in before.items() if k != 'name'} == {
                    k: v for k, v in after.items() if k != 'name'
                }, 'Unexpected data change'
        changed[filename] = updated

    original_m3u = originals['template.m3u']
    lines = original_m3u.splitlines(keepends=True)
    positions = [
        i for i, line in enumerate(lines)
        if re.search(rf'/live/\{{\{{USER\}}\}}/\{{\{{PASS\}}\}}/{STREAM_ID}\.ts\s*$', line)
    ]
    assert len(positions) == 1 and positions[0] > 0, 'Event URL not found exactly once'
    idx = positions[0] - 1
    meta = lines[idx].rstrip('\r\n')
    assert meta.startswith('#EXTINF:-1 ')
    assert meta.count('group-title=') in (1, 3)
    assert meta.count('group-title=') == 1 or BAD_GROUP in meta
    match = re.match(r'^#EXTINF:-1 tvg-id="([^"]*)" tvg-name=', meta)
    assert match, 'Unexpected event EXTINF'
    row = next(r for r in json.loads(originals[JSON_FILES[0]]) if r['stream_id'] == STREAM_ID)
    fixed = (
        f'#EXTINF:-1 tvg-id="{match.group(1)}" tvg-name="{CLEAN_NAME}" '
        f'tvg-logo="{row["stream_icon"]}" group-title="{CATEGORY_NAME}",{CLEAN_NAME}'
    )
    lines[idx] = fixed + ('\r\n' if lines[idx].endswith('\r\n') else '\n')
    repaired_m3u = ''.join(lines)
    assert original_m3u.count(f'/{STREAM_ID}.ts') == repaired_m3u.count(f'/{STREAM_ID}.ts') == 1
    assert sum(l.startswith('#EXTINF') for l in original_m3u.splitlines()) == sum(
        l.startswith('#EXTINF') for l in repaired_m3u.splitlines()
    ), 'Changed stream count'
    assert all(l.count('group-title=') == 1 for l in repaired_m3u.splitlines() if l.startswith('#EXTINF')), 'Malformed group remains'
    assert BAD_GROUP not in repaired_m3u, 'Old group remains'
    assert repaired_m3u.count(f'group-title="{CATEGORY_NAME}"') == 6756, 'PPV count changed'
    assert len({
        re.search(r'group-title="([^"]+)"', l).group(1)
        for l in repaired_m3u.splitlines() if l.startswith('#EXTINF')
    }) == 25, 'Not exactly 25 M3U groups'
    changed['template.m3u'] = repaired_m3u

    touched = [name for name, data in changed.items() if data != originals[name]]
    if not dry_run:
        for name in touched:
            (catalog / name).write_text(changed[name], encoding='utf-8')
    return {
        'touched': touched, 'event_stream_id': STREAM_ID, 'ppv_count': 6756,
        'unique_groups': 25, 'stream_urls_changed': 0, 'ids_changed': 0,
        'logos_changed': 0, 'dry_run': dry_run
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog-dir', required=True, type=Path)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    print(json.dumps(repair(args.catalog_dir, args.dry_run), ensure_ascii=False, indent=2))
