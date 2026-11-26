"""Stage and publish the production-derived Issue 36 catalogue edit."""
from collections import Counter, defaultdict
import html
import importlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

sync = importlib.import_module('catalogue-sync')
rules = importlib.import_module('catalogue-cleanup-rules')
MARKER = 'catalog/cleanup-36.json'
SESSION = f'issue-36/{os.environ.get("GITHUB_RUN_ID", "local")}'


def client():
    import boto3

    account = os.environ['R2_ACCOUNT_ID']
    sync.require(re.fullmatch('[a-f0-9]{32}', account), 'Invalid R2 account')
    return boto3.client('s3', endpoint_url=f'https://{account}.r2.cloudflarestorage.com',
                        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'], region_name='auto')


def video_probe(row):
    root = os.environ['BEST_SYNC_ORIGIN'].rstrip('/')
    user = quote(os.environ['BEST_SYNC_USERNAME'], safe='')
    password = quote(os.environ['BEST_SYNC_PASSWORD'], safe='')
    sid = int(row['stream_id'])
    status = 'no video frame'
    for path in (f'/{user}/{password}/{sid}', f'/live/{user}/{password}/{sid}.ts'):
        try:
            with urlopen(Request(root + path, headers={'User-Agent': 'VLC/3.0.21'}), timeout=9) as response:
                video = response.read(850_000)
            result = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-map', '0:v:0',
                                     '-frames:v', '1', '-f', 'framehash', '-'],
                                    input=video, capture_output=True, timeout=10)
            if result.returncode == 0 and re.search(rb'^0,', result.stdout, re.M):
                return 'decoded'
        except HTTPError as error:
            status = f'HTTP {error.code}'
        except (URLError, TimeoutError, subprocess.TimeoutExpired):
            status = 'timeout'
    return status


def select_nine(rows, provider):
    nine_rows = [row for row in rows if str(row['category_id']) == '2' and rules.NINE.match(row['name'])]
    national = [row for row in provider if (m := rules.NINE.match(row['name'])) and m[1].lower() == 'national']
    known = {row['stream_id'] for row in nine_rows if row['epg_channel_id']}
    for row in national:
        if int(row['stream_id']) not in known:
            sync.report({'national_without_validated_guide': True, 'probe': video_probe(row)})
    for region in ('national', 'sydney'):
        for row in nine_rows:
            if rules.NINE.match(row['name'])[1].lower() == region and row['epg_channel_id']:
                status = video_probe(row)
                sync.report({'channel_nine_region': region, 'playback': status})
                if status == 'decoded':
                    return row, True
    fallback = next((row for row in nine_rows if rules.NINE.match(row['name'])[1].lower() == 'sydney'
                     and row['epg_channel_id']), None)
    sync.require(fallback is not None, 'No Sydney Channel 9 position with a verified guide')
    return fallback, False


def alternate_nine_probe(r2):
    pointer, _ = sync.active(r2, sync.PROD)
    assets = sync.catalogue(r2, sync.PROD, pointer['release'])
    visible = {row['stream_id'] for row in json.loads(assets[sync.LIVE])}
    _, inventory = sync.provider_inventory()
    for row in inventory:
        label = rules.audited_label(row['name'])
        if re.match(r'^(?:AUS?\s*[|:]\s*)?(?:CHANNEL\s*)?(?:9|NINE)\b', label, re.I) and re.search(
                r'\b(?:sydney|nsw|national)\b', label, re.I):
            sync.report({'alternate_check': label, 'currently_visible': int(row['stream_id']) in visible,
                         'playback': video_probe(row)})


def duplicate_sets(kids):
    by_key = defaultdict(list)
    for row in kids:
        key = rules.kids_identity(row)
        if key is not None:
            by_key[key].append(row)
    return [rows for rows in by_key.values() if len(rows) > 1]


def dedup_kids(kids, probe):
    dropped = set()
    evidence = []
    for group in duplicate_sets(kids):
        guide_ids = {row['epg_channel_id'] for row in group if row['epg_channel_id']}
        if len(guide_ids) > 1:
            evidence.append({'status': 'distinct guide mappings', 'count': len(group)})
            continue

        def priority(row):
            quality = rules.audited_label(row['name']).upper().split()[-1]
            return bool(row['epg_channel_id']), {'RAW': 3, 'FHD': 2, 'HD': 1}.get(quality, 0)

        ranked = sorted(group, key=priority, reverse=True)
        best = next((row for row in ranked if probe(row) == 'decoded'), None)
        if best is None:
            evidence.append({'status': 'no confirmed working equivalent', 'count': len(group)})
            continue
        # An unmapped variant must not displace a verified guide mapping.
        if guide_ids and not best['epg_channel_id']:
            evidence.append({'status': 'working variant has no verified guide', 'count': len(group)})
            continue
        removed = [row['stream_id'] for row in group if row is not best]
        dropped.update(removed)
        evidence.append({'kept': best['stream_id'], 'removed': removed})
    return dropped, evidence


def playlist(assets, updated, moved, kids_name):
    source = assets[sync.PLAYLIST]
    blocks = re.split(rb'(?m)(?=^#EXTINF:)', source)
    prefix, entries = blocks[0], blocks[1:]
    route = re.compile(rb'^\{\{BASE\}\}/live/\{\{USER\}\}/\{\{PASS\}\}/(\d+)\.(?:ts|mpd|m3u8)\r?$', re.M)
    by_id = {int(route.search(block)[1]): block for block in entries}
    sync.require(len(by_id) == len(entries), 'Playlist block identity collision')
    group = html.escape(kids_name, quote=True).encode()

    def block(row):
        sid = row['stream_id']
        previous = by_id[sid]
        if sid in moved:
            first, separator, remaining = previous.partition(b'\n')
            first, replacements = re.subn(rb'group-title="[^"]*"', lambda _: b'group-title="' + group + b'"', first)
            sync.require(replacements == 1, 'Moved playlist item has unexpected metadata')
            return first + separator + remaining
        return previous

    return prefix + b''.join(block(row) for row in updated)


def transform(assets, nine, probe):
    rows = json.loads(assets[sync.LIVE])
    categories = json.loads(assets[sync.CATEGORIES])
    names = {str(cat['category_id']): cat['category_name'] for cat in categories}
    sync.require(str(categories[-1]['category_id']) == '25', 'Event category must be last')
    before = defaultdict(list)
    after = defaultdict(list)
    excluded = defaultdict(list)
    moved = []
    for row in rows:
        category = str(row['category_id'])
        before[category].append(row)
        exclusion = rules.reason(category, names[category], row['name'])
        if exclusion:
            excluded[exclusion].append(row['stream_id'])
        elif category == '23' and rules.KIDS.fullmatch(rules.audited_label(row['name'])):
            moved.append(row)
        else:
            after[category].append(row)

    numbers = {rules.KIDS.fullmatch(rules.audited_label(row['name']))[1] for row in moved}
    sync.require(len(moved) == 12 and numbers == {str(i) for i in range(1, 13)}, 'Numbered kids block differs from the approved 12')
    dupe_ids, decisions = dedup_kids(after['13'] + moved, probe)
    sync.require(not dupe_ids.intersection(row['stream_id'] for row in moved), 'Duplicate rule would remove a numbered kids feed')
    kids = [row for row in after['13'] if row['stream_id'] not in dupe_ids]
    if dupe_ids:
        excluded['Kids duplicates'] = sorted(dupe_ids)
    middle = len(kids) // 2
    moved_ids = {row['stream_id'] for row in moved}
    new_kids = [dict(row, category_id=type(row['category_id'])('13')) for row in moved]
    after['13'] = kids[:middle] + new_kids + kids[middle:]

    sync.require(nine in after['2'], 'Chosen Channel 9 is not a retained Australian entry')
    after['2'].remove(nine)
    after['2'].insert(0, nine)
    sync.require(after['25'] == before['25'], 'Live events changed')
    new_categories = [cat for cat in categories if str(cat['category_id']) != '23' or after['23']]
    after_rows = [row for cat in new_categories for row in after[str(cat['category_id'])]]
    output = dict(assets)
    if new_categories != categories:
        output[sync.CATEGORIES] = sync.encode(new_categories)
        output.pop('catalog/by-category/23.json')
    for cat in new_categories:
        category = str(cat['category_id'])
        if before[category] != after[category]:
            output[f'catalog/by-category/{category}.json'] = sync.encode(after[category])
    output[sync.LIVE] = sync.encode(after_rows)
    output[sync.PLAYLIST] = playlist(assets, after_rows, moved_ids, names['13'])
    removed_ids = {sid for ids in excluded.values() for sid in ids}
    retained = {row['stream_id']: row for row in after_rows}
    for row in rows:
        sid = row['stream_id']
        if sid not in removed_ids:
            expected = dict(row, category_id=type(row['category_id'])('13')) if sid in moved_ids else row
            sync.require(retained[sid] == expected, 'Unrelated channel data changed')
    output[MARKER] = sync.encode({'excluded_ids': sorted(removed_ids), 'moved_ids': sorted(moved_ids),
                                  'categories_sha256': sync.sha(output[sync.CATEGORIES])})
    return output, {'removed': {key: len(ids) for key, ids in excluded.items()},
                    'removed_ids': dict(excluded), 'moved_ids': sorted(moved_ids), 'duplicate_decisions': decisions,
                    'selected_nine': {'name': nine['name'], 'id': nine['stream_id'], 'epg': nine['epg_channel_id']},
                    'total': [len(rows), len(after_rows)], 'category_total': [len(categories), len(new_categories)],
                    'counts': {names[key]: [len(before[key]), len(after[key])] for key in names if before[key] != after[key]}}


def bundle_cipher():
    from cryptography.fernet import Fernet
    from base64 import urlsafe_b64encode
    from hashlib import sha256

    shared = os.environ['LTV_CATALOGUE_D1_TOKEN']
    sync.require(bool(shared), 'Shared protected job credential is unavailable')
    return Fernet(urlsafe_b64encode(sha256((SESSION + '\0' + shared).encode()).digest()))


def prepare(r2, artifact):
    pointer, _ = sync.active(r2, sync.PROD)
    original = sync.catalogue(r2, sync.PROD, pointer['release'])
    sync.require(MARKER not in original, 'Cleanup has already been released')
    sync.run_builder(original, baselineOnly=True)
    before = sync.guide_contract(r2, sync.PROD, original)
    _, provider = sync.provider_inventory()
    rows = json.loads(original[sync.LIVE])
    nine, nine_verified = select_nine(rows, provider)
    frozen = json.loads(sync.get(r2, sync.PROD, sync.INPUT + 'LoungeTV_EPG_Mappings.json')[0])['items']
    linked = [row for row in frozen if row['matched_tvg_id'] == nine['epg_channel_id']]
    sync.require(linked, 'Channel 9 has no approved EPG source')
    if 'sydney' in nine['name'].lower():
        guide_evidence = [str(row.get('source_id', '')) + ' ' + str(row.get('channel_name', '')) for row in linked]
        sync.require(any(re.search(r'sydney|\bnsw\b', value, re.I) for value in guide_evidence),
                     'Frozen guide data did not independently confirm Channel 9 Sydney')
    candidate, evidence = transform(original, nine, video_probe)
    sync.run_builder(candidate, baselineOnly=True)
    after = sync.guide_contract(r2, sync.PROD, candidate)
    removed = {sid for ids in evidence['removed_ids'].values() for sid in ids}
    sync.require(after == {sid: epg for sid, epg in before.items() if sid not in removed},
                 'Retained guide mappings changed')
    bundle = {'baseline': pointer['release'], 'guide': pointer.get('epg_release', pointer['release']),
              'assets': {key: raw.decode() for key, raw in candidate.items()}, 'evidence': evidence,
              'nine_verified': nine_verified}
    artifact.write_bytes(bundle_cipher().encrypt(sync.encode(bundle)))
    sync.report({key: evidence[key] for key in ('removed', 'total', 'category_total', 'counts')})
    sync.report({'moved': len(evidence['moved_ids']), 'selected_nine': nine['name'], 'nine_verified': nine_verified, 'rollback': pointer['release']})


def stage_or_publish(r2, artifact, bucket):
    bundle = json.loads(bundle_cipher().decrypt(artifact.read_bytes()))
    assets = {key: data.encode() for key, data in bundle['assets'].items()}
    sync.run_builder(assets, baselineOnly=True)
    pointer, etag = sync.active(r2, bucket)
    release = f'vcat-cleanup-36-{os.environ["GITHUB_RUN_ID"]}-{os.environ["GITHUB_RUN_ATTEMPT"]}'
    manifest = {'parent': pointer['release'], 'production_baseline': bundle['baseline'],
                'assets': {key: sync.sha(data) for key, data in assets.items()}}
    if bucket == sync.PROD:
        sync.require(bundle['nine_verified'], 'Channel 9 playback validation did not pass')
        sync.require(pointer['release'] == bundle['baseline'], 'Production baseline changed during QA')
        sync.guide_contract(r2, bucket, assets)
        original = sync.catalogue(r2, bucket, pointer['release'])
        rollback = f'{release}-rollback'
        sync.stage(r2, bucket, rollback, original, {'parent': pointer['release'],
                  'assets': {key: sync.sha(data) for key, data in original.items()}})
        manifest['rollback_snapshot'] = rollback
    sync.stage(r2, bucket, release, assets, manifest)
    sync.put_json(r2, bucket, f'releases/{release}/cleanup-report.json', bundle['evidence'], IfNoneMatch='*')
    if bucket == sync.PROD:
        sync.switch(r2, bucket, pointer, etag, release)
        sync.report({'published': release, 'rollback_snapshot': rollback, 'guide': pointer.get('epg_release', pointer['release'])})
    else:
        sync.report({'qa_staged': release, 'production_baseline': bundle['baseline'],
                     'sha256': sync.sha(assets[sync.LIVE])})


if __name__ == '__main__':
    try:
        action = sys.argv[1]
        artifact = Path('cleanup.bundle')
        r2 = client()
        if action == 'probe-nine':
            alternate_nine_probe(r2)
        elif action == 'prepare':
            prepare(r2, artifact)
        elif action in ('qa', 'publish'):
            stage_or_publish(r2, artifact, sync.QA if action == 'qa' else sync.PROD)
        else:
            raise sync.SyncError('Unknown cleanup operation')
    except sync.SyncError as error:
        raise SystemExit(str(error)) from None
    except Exception as error:
        raise SystemExit(f'Catalogue cleanup stopped ({type(error).__name__})') from None
