#!/usr/bin/env python3
"""Refresh the approved guide using its frozen Lounge ID → upstream ID mappings."""
import argparse
import base64
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
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
FREEVIEW = {
    900000001: 'mjh-tvnz-1', 900000002: 'mjh-tvnz-2', 900000003: 'mjh-three',
    900000004: 'mjh-maori-tv', 900000005: 'mjh-te-reo',
}
FREEVIEW_SOURCE = {
    'id': 'loungetv_freeview',
    'url': 'https://raw.githubusercontent.com/Gazzamoo111/lounge-tv-player/epg-data/epg/guide.xml',
}


def download_events(source, wanted, cache_dir, now):
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', source['id']) or urlsplit(source['url']).scheme != 'https':
        raise ValueError('Invalid approved source configuration')
    cap_mb = int(source.get('max_mb', 600))
    path, status = fetch(source, cache_dir, refresh=True, max_mb=cap_mb)
    if path is None or status != 'downloaded':
        raise RuntimeError(f"Guide source unavailable: {source['id']}")
    return read_programmes(path, wanted, now)


def build_assets(sources, mappings, catalogue, now, load_events, *,
                 previous=None, visible=None, maintenance=False):
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
    extra = len(FREEVIEW) if previous is not None else 0
    if (len(catalogue), len(streams), len(winners)) != (14_717 + extra, 3_235 + extra, 2_849 + extra):
        raise ValueError('Approved catalogue or mapping count changed')

    def load(ident):
        try:
            return load_events(indexed[ident], wanted[ident])
        except Exception as error:
            if previous is None:
                raise
            print('GUIDE_SOURCE_UNAVAILABLE', ident, type(error).__name__, flush=True)
            return {}

    with ThreadPoolExecutor(max_workers=6) as pool:
        events = dict(zip(wanted, pool.map(load, wanted)))
    schedules = {}
    extended = set()
    for guide_id, (source, ident) in winners.items():
        fresh = events[source].get(ident, [])
        if previous is not None:
            old = previous.get(guide_id, [])
            old_quality = best_program_quality(old, now)
            new_quality = best_program_quality(fresh, now)
            # A source outage or narrower horizon must not displace usable live data.
            fresh_end = max((stop for _, stop, _ in fresh), default=now)
            old_end = max((stop for _, stop, _ in old), default=now)
            if (any(before and not after for before, after in zip(old_quality, new_quality))
                    or new_quality == old_quality and fresh_end < old_end):
                fresh = old
            elif fresh_end > old_end and any(new_quality):
                extended.add(guide_id)
        schedules[guide_id] = fresh
    missing = sum(
        not any(best_program_quality(entries, now)) for entries in schedules.values()
    )
    if missing and previous is None:
        raise RuntimeError(f'{missing} approved guide IDs lack current or upcoming schedules; keeping the active guide')
    if previous is not None:
        before = {sid: best_program_quality(previous.get(gid, []), now)
                  for sid, gid in streams.items() if sid in visible}
        after = {sid: best_program_quality(schedules[streams[sid]], now) for sid in before}
        lost = sum(any(a and not b for a, b in zip(before[sid], after[sid])) for sid in before)
        current_before = sum(quality[0] for quality in before.values())
        current_after = sum(quality[0] for quality in after.values())
        print('EPG_RECOVERY_COVERAGE', json.dumps({
            'current_before': current_before, 'current_after': current_after,
            'next_12h_before': sum(quality[1] for quality in before.values()),
            'next_12h_after': sum(quality[1] for quality in after.values()),
            'visible_regressions': lost, 'source_ids_without_near_term_programmes': missing,
        }), flush=True)
        if lost or (not maintenance and current_after <= current_before):
            raise RuntimeError('Recovery did not improve coverage without regression')
        if maintenance:
            upcoming_after = sum(quality[1] for quality in after.values())
            if current_after * 100 < len(after) * 95 or upcoming_after * 100 < len(after) * 95:
                raise RuntimeError('Scheduled candidate is below the mapped-channel coverage floor')
            if not all(after.get(sid) == (True, True) for sid in FREEVIEW):
                raise RuntimeError('Scheduled candidate is missing a protected Freeview listing')
            gained = any(before[sid] != after[sid] or streams[sid] in extended for sid in before)
            print('EPG_SCHEDULE_FRESHNESS', json.dumps({
                'mapped_visible': len(after), 'visible_schedules_extended': sum(
                    streams[sid] in extended for sid in after), 'will_publish': gained,
            }), flush=True)
            if not gained:
                return {}, 0

    guide = ET.Element('tv', {'generator-info-name': 'Lounge TV verified EPG'})
    for guide_id, name in display.items():
        channel = ET.SubElement(guide, 'channel', {'id': guide_id})
        ET.SubElement(channel, 'display-name').text = name
    short = {}
    count = 0
    utc_format = '%Y-%m-%d %H:%M:%S'
    for guide_id, entries in schedules.items():
        listings = []
        seen = set()
        rows = sorted(entries, key=lambda row: (row[0], row[1]))
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


def compile_current(client, now, bucket=BUCKET, *, recover=False, maintenance=False):
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
    visible = {row['stream_id']: row for row in catalogue}
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
        previous = None
        if recover:
            if bucket != PRODUCTION_BUCKET:
                raise ValueError('Recovery must target the production bucket')
            approved_guides = {row['matched_tvg_id'] for row in mappings['items']} | set(FREEVIEW.values())
            previous_path = Path(cache_dir) / 'previous.xml.gz'
            with client.get_object(Bucket=bucket, Key=f'releases/{epg_release}/epg/guide.xml.gz')['Body'] as body:
                previous_path.write_bytes(body.read())
            previous = read_programmes(previous_path, approved_guides, now, horizon_hours=168)
            new_catalogue = list(catalogue)
            new_mappings = list(mappings['items'])
            for stream_id, guide_id in FREEVIEW.items():
                row = visible.get(stream_id)
                if not row or row['epg_channel_id'] != guide_id:
                    raise ValueError(f'Visible Freeview mapping changed for stream {stream_id}')
                new_mappings.append({'playlist_index': len(new_catalogue), 'channel_name': row['name'],
                    'matched_tvg_id': guide_id, 'source': FREEVIEW_SOURCE['id'], 'source_id': guide_id})
                new_catalogue.append(row)
            catalogue = new_catalogue
            mappings = {'items': new_mappings}
            sources = {'sources': [*sources['sources'], FREEVIEW_SOURCE]}
        assets, count = build_assets(
            sources['sources'], mappings['items'], catalogue, now,
            lambda source, wanted: download_events(source, wanted, Path(cache_dir), now),
            previous=previous, visible=visible, maintenance=maintenance,
        )
    return current, etag, assets, count


SCHEDULED_RELEASE = re.compile(r'vepg-auto-\d+-\d+\Z')
RETENTION = timedelta(days=7)


def remove_old_scheduled_assets(client, bucket, now, active, previous, active_etag):
    """Keep the live guide and its rollback indefinitely; age out only our own retired assets."""
    pages = client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix='releases/vepg-auto-')
    candidates = []
    for page in pages:
        for obj in page.get('Contents', []):
            _, release, path = obj['Key'].split('/', 2)
            if (SCHEDULED_RELEASE.fullmatch(release) and path.startswith('epg/')
                    and release not in {active, previous} and obj['LastModified'] < now - RETENTION):
                candidates.append({'Key': obj['Key']})
    if candidates:
        current = client.get_object(Bucket=bucket, Key='current.json')
        current['Body'].close()
        if current['ETag'] != active_etag:
            raise RuntimeError('Live guide changed before scheduled archive maintenance')
        for i in range(0, len(candidates), 1000):
            result = client.delete_objects(Bucket=bucket, Delete={'Objects': candidates[i:i+1000], 'Quiet': True})
            if result.get('Errors'):
                raise RuntimeError('Could not remove expired scheduled guide assets')
        print('EPG_RETIRED_ASSETS_PRUNED', len(candidates), flush=True)


def publish(client, now, bucket=BUCKET, *, recover=False, dry_run=False, maintenance=False):
    current, etag, assets, count = compile_current(client, now, bucket, recover=recover, maintenance=maintenance)
    catalogue_release = current['release']
    epg_release = current.get('epg_release', catalogue_release)
    if not assets:
        print('EPG_SCHEDULE_VERIFIED_NO_CHANGE', epg_release, flush=True)
        return
    if dry_run:
        print('EPG_RECOVERY_STAGED', json.dumps({'catalogue': catalogue_release, 'active_guide': epg_release,
              'streams': len(assets) - 1, 'programmes': count}), flush=True)
        return
    if maintenance:
        remove_old_scheduled_assets(client, bucket, now, epg_release, current.get('previous_epg_release'), etag)
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
    release = f'vepg-{"auto-" if maintenance else ""}{run_id}-{attempt}'
    def upload(item):
        path, raw = item
        params = {'ContentType': 'application/gzip'}
        if path.endswith('.json'):
            params = {'ContentType': 'application/json', 'ContentEncoding': 'gzip'}
        client.put_object(Bucket=bucket, Key=f'releases/{release}/{path}',
                          Body=raw, IfNoneMatch='*', **params)
    with ThreadPoolExecutor(max_workers=16) as pool:
        for _ in pool.map(upload, assets.items()):
            pass
    if recover:
        prefix = f'releases/{release}/'
        stored = {obj['Key'].removeprefix(prefix): obj['Size']
                  for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix)
                  for obj in page.get('Contents', [])}
        if stored != {name: len(raw) for name, raw in assets.items()}:
            raise RuntimeError('Staged guide assets do not match the expected inventory')
    updated = {
        'release': catalogue_release,
        'epg_release': release,
        'previous_epg_release': epg_release,
    }
    client.put_object(Bucket=bucket, Key='current.json', Body=json.dumps(updated).encode(),
                      ContentType='application/json', CacheControl='no-store', IfMatch=etag)
    if recover:
        with client.get_object(Bucket=bucket, Key='current.json')['Body'] as body:
            if json.load(body) != updated:
                raise RuntimeError('The live EPG pointer did not match the staged release')
    print(json.dumps({'epg_release': release, 'streams': len(assets) - 1, 'programmes': count}))


if __name__ == '__main__':
    import boto3
    from botocore.config import Config

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recover-production', action='store_true')
    parser.add_argument('--scheduled-production', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    account = os.environ['R2_ACCOUNT_ID']
    if not re.fullmatch(r'[a-f0-9]{32}', account):
        raise ValueError('Invalid Cloudflare account ID')
    r2 = boto3.client(
        's3', endpoint_url=f'https://{account}.r2.cloudflarestorage.com', region_name='auto',
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        config=Config(max_pool_connections=20, retries={'mode': 'standard', 'max_attempts': 8}),
    )
    bucket = os.environ.get('LTV_XTREAM_R2_BUCKET', BUCKET)
    if bucket not in (BUCKET, PRODUCTION_BUCKET):
        raise ValueError('Invalid Xtream R2 bucket')
    if args.scheduled_production and bucket != PRODUCTION_BUCKET:
        raise ValueError('Scheduled refresh must target the production bucket')
    publish(r2, datetime.now(timezone.utc), bucket, recover=args.recover_production or args.scheduled_production,
            dry_run=args.dry_run, maintenance=args.scheduled_production)
