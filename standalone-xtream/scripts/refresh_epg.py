#!/usr/bin/env python3
"""Refresh the approved guide using its frozen Lounge ID → upstream ID mappings."""
import base64
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

from epg_compiler import best_program_quality, fetch, read_programmes

BUCKET = 'loungetv-xtream-private'
PRODUCTION_BUCKET = 'loungetv-xtream-production-private'
INPUTS = 'refresh-inputs'
MAX_REFRESH_BYTES = 2_000_000_000
RELEASE_ID = re.compile(r'v[a-zA-Z0-9_-]{1,48}\Z')


def download_events(source, wanted, cache_dir, now):
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', source['id']) or urlsplit(source['url']).scheme != 'https':
        raise ValueError('Invalid approved source configuration')
    cap_mb = int(source.get('max_mb', 600))
    path, status = fetch(source, cache_dir, refresh=True, max_mb=cap_mb)
    if path is None or status != 'downloaded':
        raise RuntimeError(f"Guide source unavailable: {source['id']}")
    return read_programmes(path, wanted, now)


def build_assets(sources, mappings, catalogue, now, load_events):
    """Emit a guide only when every approved channel has a genuine schedule."""
    indexed = {source['id']: source for source in sources}
    wanted = defaultdict(set)
    winners = {}
    streams = {}
    display = {}
    for row in mappings:
        guide_id = row['matched_tvg_id']
        channel = catalogue[row['playlist_index']]
        upstream = (row['source'], row['source_id'])
        if channel['epg_channel_id'] != guide_id or winners.setdefault(guide_id, upstream) != upstream:
            raise ValueError('Approved EPG mappings do not agree with the active catalogue')
        stream_id = channel['stream_id']
        if stream_id in streams:
            raise ValueError('Duplicate approved stream mapping')
        streams[stream_id] = guide_id
        display.setdefault(guide_id, row['channel_name'])
        wanted[upstream[0]].add(upstream[1])
    if len(catalogue) != 14_717 or len(streams) != 3_235 or len(winners) != 2_849:
        raise ValueError('Approved catalogue or mapping count changed')

    with ThreadPoolExecutor(max_workers=4) as pool:
        events = dict(zip(wanted, pool.map(lambda ident: load_events(indexed[ident], wanted[ident]), wanted)))
    missing = sum(
        not any(best_program_quality(events[source].get(ident, []), now))
        for source, ident in winners.values()
    )
    if missing:
        raise RuntimeError(f'{missing} approved guide IDs lack current or upcoming schedules; keeping the active guide')

    guide = ET.Element('tv', {'generator-info-name': 'Lounge TV verified EPG'})
    for guide_id, name in display.items():
        channel = ET.SubElement(guide, 'channel', {'id': guide_id})
        ET.SubElement(channel, 'display-name').text = name
    short = {}
    count = 0
    utc_format = '%Y-%m-%d %H:%M:%S'
    for guide_id, (source, ident) in winners.items():
        listings = []
        seen = set()
        rows = sorted(events[source][ident], key=lambda row: (row[0], row[1]))
        for start, stop, xml in rows:
            programme = ET.fromstring(xml)
            title = programme.findtext('title')
            identity = (start, stop, title)
            if identity in seen:
                continue
            seen.add(identity)
            programme.set('channel', guide_id)
            guide.append(programme)
            count += 1
            if stop <= now or len(listings) >= 60:
                continue
            desc = programme.findtext('desc') or ''
            listings.append({
                'id': str(len(listings) + 1), 'epg_id': guide_id,
                'title': base64.b64encode(title.encode()).decode(),
                'description': base64.b64encode(desc.encode()).decode(),
                'start': start.strftime(utc_format), 'end': stop.strftime(utc_format),
                'start_timestamp': int(start.timestamp()), 'stop_timestamp': int(stop.timestamp()),
                'has_archive': 0,
            })
        short[guide_id] = gzip.compress(json.dumps({'epg_listings': listings}, separators=(',', ':')).encode(), mtime=0)
    assets = {
        'epg/guide.xml.gz': gzip.compress(ET.tostring(guide, encoding='utf-8', xml_declaration=True), mtime=0),
        **{f'epg/short/{stream_id}.json': short[guide_id] for stream_id, guide_id in streams.items()},
    }
    return assets, count


def compile_current(client, now, bucket=BUCKET):
    def get(key):
        result = client.get_object(Bucket=bucket, Key=key)
        with result['Body'] as body:
            return json.load(body), result['ETag']

    current, etag = get('current.json')
    catalogue_release = current['release']
    epg_release = current.get('epg_release', catalogue_release)
    if not RELEASE_ID.fullmatch(catalogue_release) or not RELEASE_ID.fullmatch(epg_release):
        raise ValueError('Invalid active R2 release pointer')
    sources, _ = get(f'{INPUTS}/Accepted_Sources.json')
    mappings, _ = get(f'{INPUTS}/LoungeTV_EPG_Mappings.json')
    catalogue, _ = get(f'releases/{catalogue_release}/catalog/live_all.json')
    if bucket == PRODUCTION_BUCKET:
        original, _ = get(f'{INPUTS}/catalogue-index-baseline.json')
        approved_guides = {
            original[item['playlist_index']]['stream_id']: item['matched_tvg_id']
            for item in mappings['items']
        }
        if any(row['stream_id'] in approved_guides and
               row['epg_channel_id'] != approved_guides[row['stream_id']] for row in catalogue):
            raise ValueError('Approved EPG mappings do not agree with the visible production catalogue')
        catalogue = original
    with tempfile.TemporaryDirectory() as cache_dir:
        assets, count = build_assets(
            sources['sources'], mappings['items'], catalogue, now,
            lambda source, wanted: download_events(source, wanted, Path(cache_dir), now),
        )
    return current, etag, assets, count


def publish(client, now, bucket=BUCKET):
    current, etag, assets, count = compile_current(client, now, bucket)
    catalogue_release = current['release']
    epg_release = current.get('epg_release', catalogue_release)
    prior_usage = sum(
        obj['Size']
        for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix='releases/vepg-')
        for obj in page.get('Contents', [])
    )
    if prior_usage + sum(map(len, assets.values())) > MAX_REFRESH_BYTES:
        raise RuntimeError('Guide storage budget reached; keeping the active guide')
    run_id = os.environ['GITHUB_RUN_ID']
    attempt = os.environ['GITHUB_RUN_ATTEMPT']
    if not run_id.isdigit() or not attempt.isdigit():
        raise ValueError('Invalid CI release identifier')
    release = f'vepg-{run_id}-{attempt}'
    for path, raw in assets.items():
        params = {'ContentType': 'application/gzip'}
        if path.endswith('.json'):
            params = {'ContentType': 'application/json', 'ContentEncoding': 'gzip'}
        client.put_object(Bucket=bucket, Key=f'releases/{release}/{path}',
                          Body=raw, IfNoneMatch='*', **params)
    updated = {
        'release': catalogue_release,
        'epg_release': release,
        'previous_epg_release': epg_release,
    }
    client.put_object(Bucket=bucket, Key='current.json', Body=json.dumps(updated).encode(),
                      ContentType='application/json', CacheControl='no-store', IfMatch=etag)
    print(json.dumps({'epg_release': release, 'streams': len(assets) - 1, 'programmes': count}))


if __name__ == '__main__':
    import boto3
    from botocore.config import Config

    account = os.environ['R2_ACCOUNT_ID']
    if not re.fullmatch(r'[a-f0-9]{32}', account):
        raise ValueError('Invalid Cloudflare account ID')
    r2 = boto3.client(
        's3', endpoint_url=f'https://{account}.r2.cloudflarestorage.com', region_name='auto',
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        config=Config(retries={'mode': 'standard', 'max_attempts': 8}),
    )
    bucket = os.environ.get('LTV_XTREAM_R2_BUCKET', BUCKET)
    if bucket not in (BUCKET, PRODUCTION_BUCKET):
        raise ValueError('Invalid Xtream R2 bucket')
    publish(r2, datetime.now(timezone.utc), bucket)
