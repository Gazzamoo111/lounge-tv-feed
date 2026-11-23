#!/usr/bin/env python3
"""Validate the exact Cloudflare QA release and optionally publish the scoped fix."""
import argparse
import collections
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.request import urlopen
import xml.etree.ElementTree as ET

import boto3

from cleanup_qa_catalog import KNOWN_UK_KEEP, QUALITY, blocks_from_m3u, normalize, plan_uk, plan_us, priority, uk_brand
from stage_nz_freeview_epg import prepare

QA_BUCKET = 'loungetv-xtream-private'
PRODUCTION_BUCKET = 'loungetv-xtream-production-private'
QA_PROGRAMME_CUTOFF = datetime(2026, 11, 23, 8, 16, 26, tzinfo=timezone.utc)
PRODUCTION_BASELINE_HASHES = {
    'catalog/template.m3u': '681d5e1173e39664e60ace9c8948f9186bdfae5c989eb3a9c50d2430fc0e9bb7',
    'catalog/by-category/25.json': 'b192870e341f13a42c3cd1fb36a6cef17ae9b406d9f07420b48f4ca9be185899',
    'epg/guide.xml.gz': '348335093597caaa8aa8b46060ff7eaa732873c75cd5f2c78d26ee54fd12d0a4',
}
QA_RELEASE_HASHES = {
    'catalog/template.m3u': 'b879f4e698c076c324be18c6b2d143b9d7f2fd8cde4a14528a1dd31415ea0bc1',
    'epg/guide.xml.gz': 'b7bff32ee1c16c7fcd626a4d22bf1ed0fb621e35b22e397bb23259a0366aaa16',
}
REQUIRED = ['catalog/live_categories.json','catalog/live_all.json','catalog/template.m3u',
            'catalog/by-category/1.json','catalog/by-category/2.json','catalog/by-category/3.json',
            'catalog/by-category/5.json','catalog/by-category/9.json','catalog/by-category/25.json']
FREEVIEW = [900000001, 900000002, 900000003, 900000004, 900000005]
FREEVIEW_GUIDES = dict(zip(FREEVIEW, (
    'mjh-tvnz-1', 'mjh-tvnz-2', 'mjh-three', 'mjh-maori-tv', 'mjh-te-reo',
)))
STATIC_GUIDE = 'https://raw.githubusercontent.com/Gazzamoo111/lounge-tv-player/epg-data/epg/guide.xml'
BASELINE = ('v20261123-deduplicated25-au9', 'v20261123-issue22')
CONFIRMED = {111546, 1458573, 111553, 1458568, 1458569, 1458570, 1458780,
             1458549, 1424873, 111557, 164074, 230678, 1198206}

def fetch(client, bucket, release, key):
    obj = client.get_object(Bucket=bucket, Key=f'releases/{release}/{key}')
    return obj['Body'].read()

def scoped_changes(catalog, guide, decisions, source, now):
    remove = {row['hidden_id'] for row in decisions}
    if remove != CONFIRMED:
        raise ValueError('Confirmed duplicate IDs differ from the approved list')
    guide_path = catalog.parent / 'epg'
    guide_path.mkdir()
    (guide_path / 'guide.xml.gz').write_bytes(guide)
    # Pass only the five previously verified source IDs to the existing matcher.
    wanted = set(FREEVIEW_GUIDES.values())
    selected_source = ET.Element('tv')
    for _, item in ET.iterparse(source, events=('end',)):
        if item.tag in ('channel', 'programme'):
            if item.get('id' if item.tag == 'channel' else 'channel') in wanted:
                selected_source.append(ET.fromstring(ET.tostring(item)))
            item.clear()
    if {x.get('id') for x in selected_source.findall('channel')} != wanted:
        raise ValueError('Legacy guide is missing a Freeview channel')
    source_path = catalog.parent / 'freeview.xml'
    ET.ElementTree(selected_source).write(source_path, encoding='utf-8')
    cat_changes, epg_changes, evidence = prepare(
        catalog, guide_path, source_path, now, guide_ids=FREEVIEW_GUIDES,
    )
    if not all(entry['current'] and entry['next_12h'] for entry in evidence.values()):
        raise ValueError('A Freeview channel lacks current and upcoming programmes')

    for name in ('live_all.json', 'by-category/3.json', 'by-category/5.json'):
        raw = cat_changes.get(name)
        rows = json.loads(raw if raw is not None else (catalog / name).read_bytes())
        visible = [row for row in rows if row['stream_id'] not in remove]
        cat_changes[name] = (json.dumps(visible, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    before_header, before_blocks = blocks_from_m3u((catalog / 'template.m3u').read_text())
    header, blocks = blocks_from_m3u(cat_changes['template.m3u'].decode())
    assert header == before_header and list(blocks) == list(before_blocks)
    for sid in blocks:
        if sid not in FREEVIEW:
            assert blocks[sid] == before_blocks[sid], 'Non-Freeview M3U block changed'
    cat_changes['template.m3u'] = (header + ''.join(block for sid, block in blocks.items() if sid not in remove)).encode()
    visible_rows = json.loads(cat_changes['live_all.json'])
    assert len(visible_rows) == 13070
    assert {row['stream_id'] for row in visible_rows} == set(blocks) - remove
    for category in (1, 3, 5):
        assert json.loads(cat_changes[f'by-category/{category}.json']) == [
            row for row in visible_rows if str(row['category_id']) == str(category)
        ]

    print('SCOPED_RELEASE_VALIDATED', json.dumps({'channels': len(visible_rows), 'removed': len(remove), 'freeview': evidence}))
    return ({f'catalog/{k}': v for k, v in cat_changes.items()},
            {f'epg/{k}': v for k, v in epg_changes.items()})


def catalogue_duplicates(rows):
    confirmed = collections.defaultdict(list)
    names = collections.defaultdict(list)
    for row in rows:
        # Event names recur across broadcasts. Sky Sport fallback and Freeview IDs are protected.
        name = row['name'].upper().replace('ᴿᴬᵂ', ' RAW ')
        if str(row['category_id']) == '25' or row['stream_id'] in FREEVIEW or 'SKY SPORT' in name:
            continue
        normalized = ' '.join(QUALITY.sub(' ', name).split())
        if not normalized:
            continue
        names[normalized].append(row)
        if row.get('epg_channel_id'):
            confirmed[normalized, row['epg_channel_id']].append(row)

    remove = set()
    for group in confirmed.values():
        keeper = max(group, key=priority)
        remove.update(row['stream_id'] for row in group if row is not keeper)
    ambiguous = sum(sum(row['stream_id'] not in remove for row in group) > 1 for group in names.values())
    return remove, ambiguous


UK_REGIONAL_FEED = re.compile(
    r'(?:(?:BBC ONE|BBC TWO|BBC 1|BBC 2|BBC1|BBC2|ITV 1|ITV1) )?'
    r'(?:CHANNEL ISLANDS?|EAST(?: MIDLANDS| YORKSHIRE)?|WEST(?: MIDLANDS| COUNTRY)?|'
    r'NORTH(?: EAST| WEST)?|SOUTH(?: EAST| WEST)?|SCOT(?:LAND)?|WALES|NI|NORTHERN IRELAND|'
    r'LONDON|MIDLANDS|YORKS(?:HIRE)?|BORDER(?: SCOTLAND)?|GRANADA|TYNE TEES|'
    r'MERIDIAN|ANGLIA|OXFORD|CAMBRIDGE|SUSSEX|KENT|WM|EM|N IRELAND|YORKSHIRE EAST|YORKSHIRE WEST)'
)
UK_PREFIX = re.compile(r'^\s*UK(?:-NOWTV)?\s*\|\s*')


def station_key(row):
    category = str(row['category_id'])
    if category not in {'2', '3', '4', '5', '6', '7', '8', '10', '11', '12', '13'}:
        return None
    name = row['name'].upper()
    if 'SKY SPORT' in name:
        return None
    if category == '3' and UK_PREFIX.match(name):
        base = normalize(name)
        brand = uk_brand(name)
        if brand:
            suffix = re.sub(
                r'^(?:BBC ONE|BBC TWO|BBC 1|BBC 2|BBC1|BBC2|ITV 1|ITV1|CHANNEL 4|CHANNEL 5)\b\s*',
                '', base,
            )
            if not suffix or UK_REGIONAL_FEED.fullmatch(suffix):
                return category, brand
        return category, base
    # Keep market, affiliate, timeshift and language qualifiers outside the explicit UK families.
    base = ' '.join(QUALITY.sub(' ', name.replace('ᴿᴬᵂ', ' RAW ')).split())
    return (category, base) if base else None


def station_duplicates(rows, guide_ids):
    groups = collections.defaultdict(list)
    for row in rows:
        key = station_key(row)
        if key:
            groups[key].append(row)
    decisions = []
    for (category, station), group in groups.items():
        if len(group) < 2:
            continue
        preferred = KNOWN_UK_KEEP.get(station) if category == '3' else None
        keeper = max(group, key=lambda row: (
            row.get('epg_channel_id') in guide_ids,
            priority(row, preferred),
        ))
        decisions.append({
            'category': category, 'station': station, 'keep': keeper['name'],
            'keep_id': keeper['stream_id'],
            'remove': [[row['stream_id'], row['name']] for row in group if row is not keeper],
        })
    return decisions


def apply_catalogue_removals(client, bucket, release, catalogue, rows, remove):
    visible = [row for row in rows if row['stream_id'] not in remove]
    if not remove:
        return visible

    def encode(items):
        return (json.dumps(items, ensure_ascii=False, separators=(',', ':')) + '\n').encode()

    affected = {str(row['category_id']) for row in rows if row['stream_id'] in remove}
    for category in affected:
        key = f'catalog/by-category/{category}.json'
        current = json.loads(catalogue[key] if key in catalogue else fetch(client, bucket, release, key))
        category_rows = [row for row in current if row['stream_id'] not in remove]
        assert category_rows == [row for row in visible if str(row['category_id']) == category]
        catalogue[key] = encode(category_rows)
    header, blocks = blocks_from_m3u(catalogue['catalog/template.m3u'].decode())
    assert set(blocks) == {row['stream_id'] for row in rows}
    catalogue['catalog/template.m3u'] = (header + ''.join(block for sid, block in blocks.items() if sid not in remove)).encode()
    catalogue['catalog/live_all.json'] = encode(visible)
    return visible


def audit_full_catalogue(client, bucket, release, catalogue):
    rows = json.loads(catalogue['catalog/live_all.json'])
    remove, ambiguous = catalogue_duplicates(rows)
    visible = [row for row in rows if row['stream_id'] not in remove]
    assert not catalogue_duplicates(visible)[0], 'Confirmed duplicate remained after catalogue pass'
    print('FULL_CATALOGUE_DUPLICATE_AUDIT', json.dumps({
        'checked': len(rows), 'confirmed_removed': len(remove), 'visible': len(visible),
        'unconfirmed_same_name_groups': ambiguous, 'removed_stream_ids': sorted(remove),
    }))
    apply_catalogue_removals(client, bucket, release, catalogue, rows, remove)


def publish(client, bucket, current, pointer, catalogue, guide):
    run = os.environ['GITHUB_RUN_ID']
    attempt = os.environ['GITHUB_RUN_ATTEMPT']
    if not run.isdigit() or not attempt.isdigit():
        raise ValueError('Invalid CI release identifier')
    target = 'prod' if bucket == PRODUCTION_BUCKET else 'qa'
    kind = 'freeview' if guide else 'stations'
    release = f'v{target}-{kind}-{run}-{attempt}'
    destination = f'releases/{release}/'

    def objects(prefix):
        return {obj['Key']: obj['Size'] for page in client.get_paginator('list_objects_v2').paginate(
            Bucket=bucket, Prefix=prefix) for obj in page.get('Contents', [])}

    if objects(destination):
        raise ValueError('Immutable QA release already exists')
    changes = catalogue | guide
    unchanged = {}
    active_guide = pointer.get('epg_release', pointer['release'])
    sources = {'catalog': pointer['release']}
    if guide:
        sources['epg'] = active_guide
    for scope, prior in sources.items():
        prefix = f'releases/{prior}/'
        unchanged.update({key.removeprefix(prefix): (key, size) for key, size in objects(prefix + scope + '/').items()
                          if key.removeprefix(prefix) not in changes})
    if len(unchanged) < (3000 if guide else 12):
        raise ValueError('The existing QA catalogue or guide is incomplete')

    def copy(entry):
        path, (key, _) = entry
        client.copy_object(Bucket=bucket, Key=destination + path, CopySource={'Bucket': bucket, 'Key': key})

    with ThreadPoolExecutor(max_workers=20) as pool:
        for _ in pool.map(copy, unchanged.items()):
            pass
    for path, raw in changes.items():
        metadata = {'ContentType': 'application/json'}
        if path.endswith('.m3u'):
            metadata = {'ContentType': 'audio/x-mpegurl'}
        elif path.endswith('.xml.gz'):
            metadata = {'ContentType': 'application/gzip'}
        elif path.startswith('epg/short/'):
            metadata['ContentEncoding'] = 'gzip'
        client.put_object(Bucket=bucket, Key=destination + path, Body=raw, IfNoneMatch='*', **metadata)
        if fetch(client, bucket, release, path) != raw:
            raise RuntimeError('Staged object differs from the validated asset')
    expected = {destination + k: size for k, (_, size) in unchanged.items()}
    expected.update({destination + k: len(v) for k, v in changes.items()})
    if objects(destination) != expected:
        raise RuntimeError('Staged release object inventory differs')

    updated = dict(pointer, release=release, epg_release=release if guide else active_guide)
    if guide:
        updated['previous_epg_release'] = active_guide
    client.put_object(Bucket=bucket, Key='current.json', Body=json.dumps(updated).encode(),
                      ContentType='application/json', CacheControl='no-store', IfMatch=current['ETag'])
    active = client.get_object(Bucket=bucket, Key='current.json')
    assert json.load(active['Body']) == updated, 'Live QA pointer did not match the published release'
    print(f'{target.upper()}_RELEASE_ACTIVE', release, 'VERIFIED_OBJECTS', len(expected), 'ROLLBACK', json.dumps(pointer))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage-scoped', action='store_true')
    parser.add_argument('--publish-scoped', action='store_true')
    parser.add_argument('--production', action='store_true')
    stations = parser.add_mutually_exclusive_group()
    stations.add_argument('--stage-stations', action='store_true')
    stations.add_argument('--publish-stations', action='store_true')
    stations.add_argument('--verify-stations', action='store_true')
    args = parser.parse_args()
    bucket = PRODUCTION_BUCKET if args.production else QA_BUCKET
    target = 'PRODUCTION' if args.production else 'QA'
    account = os.environ['R2_ACCOUNT_ID']
    access = os.environ['R2_ACCESS_KEY_ID']
    secret = os.environ['R2_SECRET_ACCESS_KEY']
    if not(account and access and secret):
        raise SystemExit('BLOCKER: R2 read-only QA credentials not configured')
    if len(account) != 32 or len(access) != 32 or len(secret) != 64:
        raise SystemExit(
            f'BLOCKER: invalid QA R2 credential lengths (account={len(account)}, '
            f'access={len(access)}, secret={len(secret)}); expected 32/32/64'
        )
    client = boto3.client('s3', endpoint_url=f'https://{account}.r2.cloudflarestorage.com',
        region_name='auto', aws_access_key_id=access, aws_secret_access_key=secret)
    current_obj=client.get_object(Bucket=bucket, Key='current.json')
    pointer=json.loads(current_obj['Body'].read())
    release=pointer['release']
    epg_release=pointer.get('epg_release',release)
    print(f'ACTIVE_{target}_RELEASE',release,'EPG_RELEASE',epg_release,'ETAG',current_obj['ETag'])
    with tempfile.TemporaryDirectory() as tmp:
        catalog = Path(tmp) / 'catalog'
        catalog.mkdir()
        content={}
        for path in REQUIRED:
            raw=fetch(client,bucket,release,path)
            content[path]=raw
            dest=catalog / path.removeprefix('catalog/')
            dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_bytes(raw)
        cats=json.loads(content['catalog/live_categories.json'])
        rows=json.loads(content['catalog/live_all.json'])
        by={int(k.split('/')[-1].removesuffix('.json')):json.loads(v)
            for k,v in content.items() if '/by-category/' in k}
        ids={r['stream_id'] for r in rows}
        ppv=by[25]
        print('CATEGORIES',len(cats),'CHANNELS',len(rows),'UNIQUE_STREAM_IDS',len(ids),
              'AU',len(by[2]),'UK',len(by[3]),'US',len(by[5]),'4K',len(by[9]),
              'NZ',len(by[1]),'PPV',len(ppv))
        print('CATEGORIES_ORDER',json.dumps([c['category_name'] for c in cats],ensure_ascii=False))
        print('PPV_SHA256',hashlib.sha256(content['catalog/by-category/25.json']).hexdigest())
        print('TEMPLATE_SHA256',hashlib.sha256(content['catalog/template.m3u']).hexdigest())
        print('CURRENT_NZ_EPG_IDS', json.dumps([
            {'id':r['stream_id'],'epg':r.get('epg_channel_id') or ''}
            for r in by[1] if r['stream_id'] in FREEVIEW]))
        assert len(rows)==len(ids),'duplicate stream IDs in current release'
        assert len(ppv)==6756,'PPV changed unexpectedly'
        assert cats[-1]['category_name']=='🏆 Live Sport | Events & PPV', 'PPV not last'
        assert 'ZZ | LIVE SPORTS EVENTS & PPV' not in content['catalog/template.m3u'].decode(), 'ZZ came back'
        decisions = plan_uk(by[3])[1] + plan_us(by[5])[1]
        rows_by_id = {row['stream_id']: row for row in rows}
        decisions = [d for d in decisions if rows_by_id[d['hidden_id']].get('epg_channel_id')
                     and rows_by_id[d['hidden_id']]['epg_channel_id'] == rows_by_id[d['keep_id']].get('epg_channel_id')]
        print('CONFIRMED_DUPLICATES', len(decisions))
        print('CLEANUP_KEEPLIST',json.dumps([
            {'group':d['group'],'keep_id':d['keep_id'],
             'hidden_id':d['hidden_id'],'reason':d['reason']}
            for d in decisions], ensure_ascii=False))
        guide=fetch(client,bucket,epg_release,'epg/guide.xml.gz')
        print('EPG_SHA256',hashlib.sha256(guide).hexdigest())
        prog_by=collections.defaultdict(list)
        guide_ids=set()
        with gzip.GzipFile(fileobj=io.BytesIO(guide),mode='rb') as g:
            for event,item in ET.iterparse(g, events=('end',)):
                if item.tag=='channel':
                    guide_ids.add(item.attrib.get('id',''))
                    item.clear()
                elif item.tag=='programme':
                    cid=item.attrib.get('channel','')
                    st=item.attrib.get('start','')[:14]
                    en=item.attrib.get('stop','')[:14]
                    if st and en:
                        prog_by[cid].append((st,en))
                    item.clear()
        guide_count=sum(len(v) for v in prog_by.values())
        mapped=[r for r in rows if r.get('epg_channel_id') in guide_ids]
        no_guide=[r['stream_id'] for r in rows if r.get('epg_channel_id') and r['epg_channel_id'] not in guide_ids]
        print('EPG_CHANNELS',len(guide_ids),'PROGRAMMES',guide_count,
              'VISIBLE_MAPPED_STREAMS',len(mapped),'UNRESOLVED_GUIDE_REFS',len(no_guide))
        print('EPG_MISSING_NZ',json.dumps([
            r['stream_id'] for r in by[1]
            if r['stream_id'] in FREEVIEW and (not r.get('epg_channel_id') or r['epg_channel_id'] not in guide_ids)
        ]))
        if args.stage_stations or args.publish_stations or args.verify_stations:
            if not args.production:
                raise ValueError('Station consolidation requires the production target')
            groups = station_duplicates(rows, guide_ids)
            remove = {sid for group in groups for sid, _ in group['remove']}
            for group in groups:
                print('STATION_GROUP', json.dumps(group))
            if args.stage_stations:
                print('UK_ENTERTAINMENT_STATIONS', json.dumps([[r['stream_id'], r['name']] for r in by[3]]))
            print('STATION_AUDIT', json.dumps({'checked': len(rows), 'groups': len(groups), 'remove': len(remove)}))
            if args.verify_stations:
                if not release.startswith('vprod-stations-') or groups:
                    raise ValueError('The active station release did not pass readback')
                return
            if release != 'vprod-freeview-45145113439-1' or epg_release != release:
                raise ValueError('Production catalogue or guide drifted before station release')
            catalogue = {key: content[key] for key in ('catalog/live_all.json', 'catalog/template.m3u')}
            visible = apply_catalogue_removals(client, bucket, release, catalogue, rows, remove)
            assert not station_duplicates(visible, guide_ids)
            assert sum(station_key(row) == ('3', 'BBC ONE') for row in visible) == 1
            print('STATION_RELEASE_VALIDATED', json.dumps({'visible': len(visible), 'removed': len(remove)}))
            if args.publish_stations:
                publish(client, bucket, current_obj, pointer, catalogue, {})
            return
        if args.production and release.startswith('vprod-freeview-'):
            remaining, ambiguous = catalogue_duplicates(rows)
            assert not remaining, 'Active production catalogue contains a confirmed duplicate'
            print('FULL_CATALOGUE_DUPLICATE_READBACK', json.dumps({
                'checked': len(rows), 'confirmed_remaining': len(remaining),
                'unconfirmed_same_name_groups': ambiguous,
            }))
        if (release, epg_release) == BASELINE or args.stage_scoped or args.publish_scoped:
            if (release, epg_release) != BASELINE or len(rows) != 13083 or len(guide_ids) != 2849:
                raise ValueError('Active QA baseline differs from the approved release')
            if args.production:
                assets = content | {'epg/guide.xml.gz': guide}
                for key, digest in PRODUCTION_BASELINE_HASHES.items():
                    if hashlib.sha256(assets[key]).hexdigest() != digest:
                        raise ValueError(f'Production baseline differs from approved QA input: {key}')
            cutoff = QA_PROGRAMME_CUTOFF if args.production else datetime.now(timezone.utc)
            with urlopen(STATIC_GUIDE, timeout=90) as source:
                replacements = scoped_changes(catalog, guide, decisions, source, cutoff)
            if args.production:
                assets = replacements[0] | replacements[1]
                for key, digest in QA_RELEASE_HASHES.items():
                    if hashlib.sha256(assets[key]).hexdigest() != digest:
                        raise ValueError(f'Staged production asset differs from the verified QA release: {key}')
                now = datetime.now(timezone.utc).timestamp()
                for sid in FREEVIEW:
                    guide_rows = json.loads(gzip.decompress(assets[f'epg/short/{sid}.json']))['epg_listings']
                    if not any(row['start_timestamp'] <= now < row['stop_timestamp'] for row in guide_rows):
                        raise ValueError(f'QA programme snapshot no longer has a current listing for {sid}')
                print('PRODUCTION_QA_HASH_PARITY_VERIFIED')
                audit_full_catalogue(client, bucket, release, replacements[0])
            if args.publish_scoped:
                publish(client, bucket, current_obj, pointer, *replacements)
                return
        print('READ_ONLY_PREFLIGHT_PASSED; no R2 objects or pointers changed')

if __name__ == '__main__':
    main()
