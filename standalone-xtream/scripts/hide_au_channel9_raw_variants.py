#!/usr/bin/env python3
"""Hide three redundant 9Now Channel 9 RAW variants in STAGED Cloudflare QA catalogue.

Run on a local copy of the CURRENT deduplicated QA R2 release only.
NEVER run against production or Supabase. Does not connect to Cloudflare.
Keep Channel 9 Sydney and Perth, 9Gem, 9Go, 9Life, 9Rush, all PPV streams.
"""
import argparse
import json
import re
from pathlib import Path

HIDE = {
    1921340: 'AU: 9NOW CHANNEL 9 (QLD) ᴿᴬᵂ',
    1921345: 'AU: 9NOW CHANNEL 9 (VIC) ᴿᴬᵂ',
    1921330: 'AU: 9NOW CHANNEL 9 (WA) ᴿᴬᵂ',
}
KEEP = {156865, 156905, 1789687, 1921348, 1921343, 1921347, 1921346}
NEEDED = ['by-category/2.json','live_all.json','template.m3u',
          'live_categories.json','by-category/25.json']


def run(catalog: Path, expected_visible: int, dry_run: bool) -> dict:
    original = {name: (catalog / name).read_text(encoding='utf-8') for name in NEEDED}
    cats = json.loads(original['live_categories.json'])
    assert len(cats) == 25, 'Expected exactly 25 approved categories'
    assert str(cats[-1]['category_id']) == '25', 'Event category not last in source'
    assert cats[-1]['category_name'] == '🏆 Live Sport | Events & PPV', 'Unexpected event category label'
    assert len(json.loads(original['by-category/25.json'])) == 6756, 'PPV inventory changed'
    all_rows = json.loads(original['live_all.json'])
    au_rows = json.loads(original['by-category/2.json'])
    assert len(all_rows) in {expected_visible, expected_visible - 3}, 'Unexpected current visible count'
    assert all(r['category_id'] == '2' for r in au_rows)
    present = {r['stream_id'] for r in au_rows if r['stream_id'] in HIDE}
    assert present == set(HIDE) or not present, 'Partial prior cleanup. Refuse update.'
    for sid, expected_name in HIDE.items():
        matches = [r for r in au_rows if r['stream_id'] == sid]
        assert len(matches) == (1 if present else 0)
        assert sum(r['stream_id'] == sid for r in all_rows) == (1 if present else 0)
        if present:
            assert matches[0]['name'] == expected_name, 'Name changed; manual review required'
            assert not matches[0]['epg_channel_id'], 'Feed now has EPG; manual review required'
    for sid in KEEP:
        assert sum(r['stream_id'] == sid for r in au_rows) == 1, f'Separate Nine channel missing: {sid}'
    changed = {}
    for name, rows in [('by-category/2.json', au_rows), ('live_all.json', all_rows)]:
        remaining = [r for r in rows if r['stream_id'] not in HIDE]
        changed[name] = json.dumps(remaining, ensure_ascii=False, separators=(',', ':')) + '\n'

    lines = original['template.m3u'].splitlines(keepends=True)
    output = []
    removed = []
    pattern = re.compile(r'/live/\{\{USER\}\}/\{\{PASS\}\}/(\d+)\.(?:ts|m3u8|mpd)\s*$')
    i = 0
    while i < len(lines):
        if not lines[i].startswith('#EXTINF'):
            output.append(lines[i]); i += 1
            continue
        j = i + 1
        while j < len(lines) and not lines[j].startswith('#EXTINF'):
            j += 1
        block = lines[i:j]
        hits = [int(m.group(1)) for line in block if (m := pattern.search(line))]
        assert len(hits) == 1, 'Unexpected M3U block structure, including DRM metadata'
        sid = hits[0]
        if sid in HIDE:
            assert HIDE[sid] in block[0] and len(block) == 2, 'Unsafe RAW variant block'
            removed.append(sid)
        else:
            output.extend(block)
        i = j
    assert sorted(removed) == (sorted(HIDE) if present else []), 'Unexpected removal'
    changed['template.m3u'] = ''.join(output)
    old_count = sum(line.startswith('#EXTINF') for line in lines)
    new_count = sum(line.startswith('#EXTINF') for line in output)
    assert old_count == len(all_rows) and new_count == len(json.loads(changed['live_all.json']))
    assert new_count == expected_visible - 3, 'Unexpected post-cleanup count'
    assert len(json.loads(changed['by-category/2.json'])) == len(au_rows) - len(present)
    touched = [name for name, new in changed.items() if new != original[name]]
    assert (set(touched) == {'by-category/2.json','live_all.json','template.m3u'}) if present else not touched
    if not dry_run:
        for name in touched:
            (catalog / name).write_text(changed[name], encoding='utf-8')
    return {
        'dry_run': dry_run, 'changed_files': touched, 'removed_ids': sorted(removed),
        'visible_before': old_count, 'visible_after': new_count,
        'australia_before': len(au_rows),
        'australia_after': len(json.loads(changed['by-category/2.json'])),
        'retained_primary_9_ids': [156905, 156865],
        'ppv_count': 6756, 'ppv_and_epg_untouched': True,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog-dir', type=Path, required=True)
    parser.add_argument('--expected-visible', type=int, default=13086)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    print(json.dumps(run(args.catalog_dir, args.expected_visible, args.dry_run), indent=2))
