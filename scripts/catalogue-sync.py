"""Release standalone Xtream catalogue assets through the existing Cloudflare bindings."""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

PROD = 'loungetv-xtream-production-private'
QA = 'loungetv-xtream-private'
DATABASES = {
    PROD: 'a3b2dbc6-f872-44c7-b397-06c578effa28',
    QA: '4f880ec7-f02d-4c52-836e-884ac4e5f21b',
}
FREEVIEW = {
    900000001: 'mjh-tvnz-1', 900000002: 'mjh-tvnz-2', 900000003: 'mjh-three',
    900000004: 'mjh-maori-tv', 900000005: 'mjh-te-reo',
}
INPUT = 'refresh-inputs/'
BASELINE = 'baseline'
LIVE = 'catalog/live_all.json'
CATEGORIES = 'catalog/live_categories.json'
PLAYLIST = 'catalog/template.m3u'
POINTER = 'current.json'
RUNS = 'catalogue-sync/'
STATE = RUNS + 'observation.json'
RELEASE = re.compile(r'v[a-zA-Z0-9_-]{1,48}')
SYNC_RELEASE = re.compile(r'vcat-sync-\d+-\d+')
BUDGET = 768_000_000


class SyncError(RuntimeError):
    """A message safe for a public CI log."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def encode(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode()


def report(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise SyncError(message)


def get(client, bucket, key, *, optional=False):
    try:
        obj = client.get_object(Bucket=bucket, Key=key)
    except client.exceptions.NoSuchKey:
        if optional:
            return None, None
        raise
    with obj['Body'] as body:
        return body.read(), obj['ETag']


def objects(client, bucket, prefix):
    return [
        obj for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix)
        for obj in page.get('Contents', [])
    ]


def put_json(client, bucket, key, obj, **conditional):
    client.put_object(Bucket=bucket, Key=key, Body=encode(obj), ContentType='application/json',
                      CacheControl='no-store', **conditional)


def active(client, bucket):
    raw, etag = get(client, bucket, POINTER)
    pointer = json.loads(raw)
    require(RELEASE.fullmatch(pointer.get('release', '')) and
            RELEASE.fullmatch(pointer.get('epg_release', pointer['release'])), 'Invalid release pointer')
    require(bool(etag), 'Catalogue pointer is missing its ETag')
    return pointer, etag


def catalogue(client, bucket, release):
    prefix = f'releases/{release}/'
    keys = [obj['Key'] for obj in objects(client, bucket, prefix + 'catalog/')]
    require(len(keys) <= 110 and all(re.fullmatch(r'catalog/[A-Za-z0-9_./-]+', key.removeprefix(prefix))
                                    for key in keys), 'Unexpected catalogue object keys')
    def read(key):
        return key.removeprefix(prefix), get(client, bucket, key)[0]
    with ThreadPoolExecutor(max_workers=10) as pool:
        result = dict(pool.map(read, keys))
    require({LIVE, CATEGORIES, PLAYLIST} <= result.keys(), 'Catalogue release is incomplete')
    return result


def guide_contract(client, bucket, assets):
    rows = {row['stream_id']: row['epg_channel_id'] for row in json.loads(assets[LIVE])}
    if bucket != PROD:
        return {sid: epg for sid, epg in rows.items() if epg}
    original = json.loads(get(client, bucket, INPUT + 'catalogue-index-baseline.json')[0])
    mappings = json.loads(get(client, bucket, INPUT + 'LoungeTV_EPG_Mappings.json')[0])['items']
    guides = {original[row['playlist_index']]['stream_id']: row['matched_tvg_id'] for row in mappings}
    require((len(original), len(guides), len(set(guides.values()))) == (14717, 3235, 2849),
            'Frozen guide baseline changed')
    require(all(rows[sid] == guides[sid] for sid in rows.keys() & guides.keys()), 'Production EPG mapping mismatch')
    require(all(rows.get(sid) == epg for sid, epg in FREEVIEW.items()), 'Missing a production Freeview guide mapping')
    return {sid: epg for sid, epg in rows.items() if epg}


def provider_http_error(error, action):
    message = f'BEST inventory {action} returned HTTP {error.code}'
    if error.code != 530:
        return SyncError(message)
    code = error.headers.get('cf-error-type', '')
    if not re.fullmatch(r'1[0-9]{3}', code):
        body = error.read(16_384).decode('utf-8', errors='replace')
        text = re.sub(r'<[^>]*>', ' ', body)
        match = re.search(r'\berror\s*(?:code\s*)?:?\s*(1[0-9]{3})\b', text, re.IGNORECASE)
        code = match.group(1) if match else ''
    if code:
        message += f' (Cloudflare error {code})'
    return SyncError(message)


def provider_inventory():
    origin = os.environ.get('BEST_SYNC_ORIGIN', '')
    user = os.environ.get('BEST_SYNC_USERNAME', '')
    password = os.environ.get('BEST_SYNC_PASSWORD', '')
    require(all((origin, user, password)), 'Authorised BEST inventory secrets are unavailable')
    parsed = urlsplit(origin)
    permitted_http = os.environ.get('BEST_SYNC_ALLOW_HTTP') == 'true'
    require(parsed.scheme in ({'https', 'http'} if permitted_http else {'https'}) and
            parsed.hostname and not any((parsed.username, parsed.password, parsed.query, parsed.fragment)) and
            parsed.path in ('', '/'), 'Invalid authorised BEST API origin')
    require(all(re.fullmatch(r'[A-Za-z0-9._~-]{1,128}', value) for value in (user, password)),
            'Invalid authorised BEST credential format')
    opener = build_opener(NoRedirect())

    def fetch(action):
        query = urlencode({'username': user, 'password': password, 'action': action})
        request = Request(origin.rstrip('/') + '/player_api.php?' + query,
                          headers={'Accept': 'application/json', 'User-Agent': 'LoungeTV-CatalogueSync'})
        limit = 32_000_000
        try:
            with opener.open(request, timeout=55) as response:
                raw = response.read(limit + 1)
        except HTTPError as error:
            raise provider_http_error(error, action) from None
        except (OSError, URLError):
            raise SyncError('BEST inventory API is unreachable') from None
        require(len(raw) <= limit, 'BEST inventory exceeded size limit')
        rows = json.loads(raw)
        require(isinstance(rows, list) and rows and all(isinstance(row, dict) for row in rows),
                'BEST inventory response is incomplete or not authorised')
        return rows

    groups = fetch('get_live_categories')
    streams = fetch('get_live_streams')
    return (
        [{key: row[key] for key in ('category_id', 'category_name')} for row in groups],
        [{key: row[key] for key in ('category_id', 'stream_id', 'name')} for row in streams],
    )


def d1(bucket, sql, parameters=()):
    token = os.environ.get('LTV_CATALOGUE_D1_TOKEN') or os.environ.get('CLOUDFLARE_API_TOKEN')
    require(bool(token), 'D1 API credential is unavailable')
    account = os.environ['R2_ACCOUNT_ID']
    endpoint = f'https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{DATABASES[bucket]}/query'
    request = Request(endpoint, data=encode({'sql': sql, 'params': parameters}),
                      headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    try:
        with urlopen(request, timeout=30) as response:
            result = json.load(response)
    except HTTPError as error:
        raise SyncError(f'D1 API returned HTTP {error.code}') from None
    require(result.get('success') and all(row.get('success') for row in result['result']), 'D1 query failed')
    return result['result'][0]['results']


def suppressed_ids(bucket, rows):
    visible = {row['stream_id'] for row in rows}
    excluded = set()
    after = 0
    while True:
        page = d1(bucket, 'SELECT stream_id FROM stream_ids WHERE stream_id > ? ORDER BY stream_id LIMIT 1000', (after,))
        excluded.update(row['stream_id'] for row in page if row['stream_id'] not in visible)
        if len(page) < 1000:
            return sorted(excluded)
        after = page[-1]['stream_id']


def register(bucket, additions):
    for start in range(0, len(additions), 30):
        batch = additions[start:start + 30]
        params = [value for row in batch for value in (row['stream_id'], int(row['category_id']))]
        values = ','.join("(?,?,'')" for _ in batch)
        d1(bucket, f'INSERT INTO stream_ids (stream_id,category_id,epg_id) VALUES {values} '
                   'ON CONFLICT(stream_id) DO NOTHING', params)
        ids = [row['stream_id'] for row in batch]
        marks = ','.join('?' for _ in ids)
        found = d1(bucket, f'SELECT stream_id,category_id,epg_id FROM stream_ids WHERE stream_id IN ({marks})', ids)
        require({(row['stream_id'], row['category_id'], row['epg_id']) for row in found} ==
                {(row['stream_id'], int(row['category_id']), '') for row in batch}, 'D1 stream registration mismatch')


def run_builder(assets, **inputs):
    script = Path(__file__).with_name('catalogue-sync-plan.mjs')
    document = {'assets': {key: value.decode() for key, value in assets.items()}, **inputs}
    result = subprocess.run(['node', str(script)], input=encode(document), stdout=subprocess.PIPE, check=True)
    return json.loads(result.stdout)


def inspect_inventory(bucket, assets):
    rows = json.loads(assets[LIVE])
    groups, streams = provider_inventory()
    known = {int(row['stream_id']): row['category_id'] for row in rows}
    excluded = set(suppressed_ids(bucket, rows))
    counts = defaultdict(Counter)
    for row in streams:
        sid = int(row['stream_id'])
        group = str(row['category_id'])
        counts[group][known.get(sid, 'suppressed' if sid in excluded else 'outside_catalogue')] += 1
    report({'provider_groups': len(groups), 'provider_streams': len(streams),
            'production_group_overlaps': dict(counts), 'registered_suppressed_ids': len(excluded)})

    categories = json.loads(assets[CATEGORIES])
    event = categories[-1]
    event_id = str(event['category_id'])
    event_groups = {
        source: row for source, row in counts.items()
        if row.get(event_id) and source != 'None'
        and not any(key.isdigit() and key != event_id for key in row)
    }
    if not event_groups:
        return
    source_names = {str(group['category_id']): group['category_name'] for group in groups}
    require(event_groups.keys() <= source_names.keys(), 'Event candidate references an unknown provider group')
    def rehearsed_plan(selected_groups, max_changes):
        exploratory_policy = {
            'eventTarget': event_id,
            'groups': {
                source: {'sourceName': source_names[source], 'targetName': event['category_name'], 'target': event_id}
                for source in selected_groups
            },
            'minimumGroupCounts': {
                source: max(1, row[event_id] * 85 // 100) for source, row in selected_groups.items()
            },
            'maxChanges': max_changes,
        }
        result = run_builder(
            assets, providerCategories=groups, providerStreams=streams, mappings=exploratory_policy,
            mode='events', protectedIds=sorted(FREEVIEW), excludedIds=sorted(excluded),
        )
        plan = result['plan']
        return {
            'provisional_groups': len(selected_groups),
            'additions': len(plan['additions']), 'renames': len(plan['renames']),
            'missing': len(plan['missing']), 'held': len(plan['pending']),
        }

    groups_with_additions = {source: row for source, row in event_groups.items() if row.get('outside_catalogue')}
    if groups_with_additions:
        report({'read_only_event_addition_groups': rehearsed_plan(groups_with_additions, 100)})
    # Rehearse the whole candidate only for a report. Publication still uses the normal limit.
    report({'read_only_full_event_rehearsal': rehearsed_plan(event_groups, len(rows))})


def approved_production_policy(assets, rows, groups, streams):
    approved = json.loads(Path(__file__).with_name('catalogue-sync-approved-groups.json').read_text())
    categories = json.loads(assets[CATEGORIES])
    cleanup = json.loads(assets.get('catalog/cleanup-36.json', b'{}'))
    approved_hash = cleanup.get('categories_sha256', '18b818148b610594c387d2a9c87934f44cec747142c58280ab58569beaba9d5d')
    require(sha(assets[CATEGORIES]) == approved_hash,
            'Production category structure differs from the approved baseline')
    targets = {str(row['category_id']): row['category_name'] for row in categories}
    source_names = {str(row['category_id']): row['category_name'] for row in groups}
    by_id = {row['stream_id']: str(row['category_id']) for row in rows}
    overlaps = defaultdict(Counter)
    for row in streams:
        target = by_id.get(int(row['stream_id']))
        if target is not None:
            overlaps[str(row['category_id'])][target] += 1
    mappings = {}
    floors = {}
    for group, (target, minimum) in approved.items():
        observed = overlaps[group]
        if group not in source_names or set(observed) != {target} or observed[target] < minimum:
            continue
        mappings[group] = {'sourceName': source_names[group], 'target': target, 'targetName': targets[target]}
        floors[group] = minimum
    report({'verified_groups': len(mappings), 'held_groups': len(approved) - len(mappings),
            'permanent_groups': sum(rule['target'] != '25' for rule in mappings.values())})
    return {
        'bucket': PROD, 'categories_sha256': sha(assets[CATEGORIES]), 'eventTarget': '25',
        'groups': mappings, 'minimumGroupCounts': floors, 'maxChanges': 100,
    }


def snapshot(client, bucket, pointer, mode):
    assets = catalogue(client, bucket, pointer['release'])
    guide = guide_contract(client, bucket, assets)
    rows = json.loads(assets[LIVE])
    categories = json.loads(assets[CATEGORIES])
    with_counts = [{**category, 'streams': sum(row['category_id'] == category['category_id'] for row in rows)}
                   for category in categories]
    report({'catalogue': pointer['release'], 'guide': pointer.get('epg_release', pointer['release']),
            'categories': with_counts, 'streams': len(rows), 'epg_linked': len(guide),
            'categories_sha256': sha(assets[CATEGORIES])})
    if mode == BASELINE:
        report(run_builder(assets, baselineOnly=True))
        return None
    if mode == 'inventory':
        inspect_inventory(bucket, assets)
        return None
    groups, streams = provider_inventory()
    if bucket == PROD:
        policy = approved_production_policy(assets, rows, groups, streams)
        mapping_etag = None
    else:
        mapping_raw, mapping_etag = get(client, bucket, RUNS + 'policy.json')
        policy = json.loads(mapping_raw)
    require(policy['bucket'] == bucket and policy['categories_sha256'] == sha(assets[CATEGORIES]),
            'Private category policy does not match the active catalogue')
    require(policy['groups'] and all(isinstance(value, dict) and
            {'target', 'targetName', 'sourceName'} <= value.keys() for value in policy['groups'].values()),
            'Exact source and target category mappings are required')
    event_groups = [group for group, rule in policy['groups'].items()
                    if str(rule['target']) == str(policy['eventTarget'])]
    floors = policy.get('minimumGroupCounts', {})
    require(event_groups and all(group in floors for group in event_groups),
            'Every approved event group needs a complete-inventory floor')
    raw, state_etag = get(client, bucket, STATE, optional=True)
    previous = json.loads(raw) if raw else {}
    if previous.get('catalogue') != pointer['release']:
        previous = {}
    if SYNC_RELEASE.fullmatch(pointer['release']):
        # A successful pointer write may outlive the runner before its state update.
        manifest = json.loads(get(client, bucket, f'releases/{pointer["release"]}/sync.json')[0])
        previous.setdefault('retired', manifest['state']['retired'])
    # Prior failed candidates can register IDs before the pointer changes.
    # Journal only those explicitly staged IDs as eligible for a retry.
    journal, _ = get(client, bucket, RUNS + 'registered-pending.json', optional=True)
    tracked = json.loads(journal) if journal else []
    excluded = set(suppressed_ids(bucket, rows)) - set(tracked)
    if 'catalog/cleanup-36.json' in assets:
        cleanup = json.loads(assets['catalog/cleanup-36.json'])
        excluded.update(cleanup['excluded_ids'])
        rules = importlib.import_module('catalogue-cleanup-rules')
        names = {str(cat['category_id']): cat['category_name'] for cat in categories}
        destinations = {group: str(rule['target']) for group, rule in policy['groups'].items()}
        for stream in streams:
            category = destinations.get(str(stream['category_id']))
            if category and (rules.reason(category, names[category], stream['name'])
                             or category == '2' and cleanup.get('sydney_suppressed') and rules.is_nine_sydney(stream['name'])
                             or category == '23' and rules.KIDS.fullmatch(rules.audited_label(stream['name']))):
                excluded.add(int(stream['stream_id']))
    protected = sorted({*FREEVIEW, *policy.get('protectedIds', []), *guide})
    # EPG rows remain independently protected against removal by the planner.
    # Only reserved and explicit overrides are exempt from provider overlap.
    document = {
        'providerCategories': groups, 'providerStreams': streams, 'mappings': policy, 'mode': mode,
        'protectedIds': sorted({*FREEVIEW, *policy.get('protectedIds', [])}),
        'excludedIds': sorted(excluded | set(policy.get('excludedIds', []))),
        'previous': previous, 'slot': int(time.time()) // 3600, 'additionsOnly': True,
    }
    candidate = run_builder(assets, **document)
    plan = candidate['plan']
    require(not (set(plan['removals']) & set(protected)), 'Candidate removes a protected or EPG-linked stream')
    changed = {key: value.encode() for key, value in candidate['assets'].items()}
    require(guide_contract(client, bucket, changed) == guide, 'Candidate changes approved EPG coverage')
    require(not (plan['renames'] or plan['removals']), 'Catalogue sync may only add streams')
    additions = {row['stream_id'] for row in plan['additions']}
    require([row for row in json.loads(changed[LIVE]) if row['stream_id'] not in additions] == rows
            and changed[CATEGORIES] == assets[CATEGORIES], 'Catalogue sync changes existing rows or categories')
    totals = {key: len(plan[key]) for key in ('additions', 'renames', 'missing', 'removals', 'pending', 'replacements')}
    by_category = {}
    for row in plan['additions']:
        key = row['category_id']
        by_category[key] = by_category.get(key, 0) + 1
    report({'mode': mode, **totals, 'addition_category_counts': by_category})
    return changed, plan, state_etag, mapping_etag, sorted(set(tracked))


def switch(client, bucket, pointer, etag, release):
    updated = {**pointer, 'release': release, 'epg_release': pointer.get('epg_release', pointer['release'])}
    put_json(client, bucket, POINTER, updated, IfMatch=etag)
    live, _ = active(client, bucket)
    # EPG is free to publish immediately after our write and will preserve our release.
    require(live['release'] == release, 'Catalogue activation readback failed')


def stage(client, bucket, release, assets, manifest):
    used = sum(obj['Size'] for obj in objects(client, bucket, 'releases/vcat-sync-'))
    require(used + sum(map(len, assets.values())) + len(encode(manifest)) <= BUDGET, 'Catalogue release storage budget reached')
    def write(item):
        key, data = item
        path = f'releases/{release}/{key}'
        client.put_object(Bucket=bucket, Key=path, Body=data, IfNoneMatch='*',
                          ContentType='audio/x-mpegurl' if key.endswith('.m3u') else 'application/json')
        require(sha(get(client, bucket, path)[0]) == sha(data), 'Immutable object readback mismatch')
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(write, (*assets.items(), ('sync.json', encode(manifest)))))


def prune(client, bucket, pointer, etag):
    keep = {pointer['release'], pointer.get('epg_release'), pointer.get('previous_epg_release')}
    if SYNC_RELEASE.fullmatch(pointer['release']):
        manifest = json.loads(get(client, bucket, f'releases/{pointer["release"]}/sync.json')[0])
        keep.add(manifest['parent'])
    cutoff = time.time() - 72 * 3600
    candidates = {}
    for obj in objects(client, bucket, 'releases/vcat-sync-'):
        release = obj['Key'].split('/')[1]
        if SYNC_RELEASE.fullmatch(release) and release not in keep:
            candidates.setdefault(release, []).append(obj)
    for items in candidates.values():
        if any(obj['LastModified'].timestamp() >= cutoff for obj in items):
            continue
        if active(client, bucket)[1] != etag:
            return
        deleted = client.delete_objects(Bucket=bucket, Delete={'Objects': [{'Key': obj['Key']} for obj in items]})
        require(not deleted.get('Errors'), 'Expired catalogue release cleanup failed')


def release_id():
    run = os.environ['GITHUB_RUN_ID']
    attempt = os.environ['GITHUB_RUN_ATTEMPT']
    result = f'vcat-sync-{run}-{attempt}'
    require(bool(SYNC_RELEASE.fullmatch(result) and RELEASE.fullmatch(result)), 'Invalid release run identifier')
    return result


def publish(client, bucket, pointer, etag, output):
    assets, plan, state_etag, mapping_etag, tracked = output
    require(not (plan['renames'] or plan['removals']), 'Catalogue sync may only add streams')
    if mapping_etag is not None:
        _, current_policy_etag = get(client, bucket, RUNS + 'policy.json')
        require(current_policy_etag == mapping_etag, 'Category policy changed during synchronisation')
    release = pointer['release']
    if any(plan[key] for key in ('additions', 'renames', 'removals')):
        prune(client, bucket, pointer, etag)
        release = release_id()
        manifest = {'parent': pointer['release'], 'counts': plan['counts'], 'state': plan['state'],
                    'assets': {key: sha(value) for key, value in assets.items()}}
        stage(client, bucket, release, assets, manifest)
        require(active(client, bucket)[1] == etag, 'Pointer changed during catalogue staging')
        additions = plan['additions']
        if additions:
            journal = sorted(set(tracked) | {row['stream_id'] for row in additions})
            require(len(journal) <= 3000, 'Too many pending D1 registrations')
            put_json(client, bucket, RUNS + 'registered-pending.json', journal)
            register(bucket, additions)
        switch(client, bucket, pointer, etag, release)
        # Keep pending IDs from unrelated failed candidates. A stale ID already
        # visible after a successful release is harmless if the runner stops here.
        if additions:
            put_json(client, bucket, RUNS + 'registered-pending.json',
                     sorted(set(tracked) - {row['stream_id'] for row in additions}))
        report({'published': release, 'rollback_catalogue': pointer['release']})
    state = {**plan['state'], 'catalogue': release, 'last_success_epoch': int(time.time())}
    put_json(client, bucket, STATE, state, **({'IfMatch': state_etag} if state_etag else {'IfNoneMatch': '*'}))
    put_json(client, bucket, RUNS + 'latest-report.json', plan)


def rollback(client, bucket, pointer, etag, expected):
    cleanup = re.fullmatch(r'vcat-cleanup-36-\d+-\d+', expected)
    require(pointer['release'] == expected and (SYNC_RELEASE.fullmatch(expected) or cleanup),
            'Active catalogue differs from rollback target')
    root = f'releases/{expected}/'
    manifest = json.loads(get(client, bucket, root + 'sync.json')[0])
    parent = manifest['rollback_snapshot'] if cleanup else manifest['parent']
    require(bool(RELEASE.fullmatch(parent)), 'Invalid rollback reference')
    old = catalogue(client, bucket, parent)
    active_assets = catalogue(client, bucket, expected)
    before = guide_contract(client, bucket, active_assets)
    after = guide_contract(client, bucket, old)
    require((all(after.get(sid) == guide for sid, guide in before.items()) if cleanup else before == after),
            'Rollback guide mappings differ')
    switch(client, bucket, pointer, etag, parent)
    report({'restored_catalogue': parent, 'replaced_catalogue': expected})


def rehearse_qa_events(client, bucket, pointer, etag, expected):
    require(bucket == QA and expected and pointer['release'] == expected,
            'Rehearsal requires the expected isolated QA baseline')
    assets = catalogue(client, bucket, expected)
    live = json.loads(assets[LIVE])
    categories = json.loads(assets[CATEGORIES])
    target = str(categories[-1]['category_id'])
    groups, streams = provider_inventory()
    group_id = '1580'
    provider_ids = {int(row['stream_id']) for row in streams if str(row['category_id']) == group_id}
    existing = [row for row in live if int(row['stream_id']) in provider_ids]
    require(existing and all(str(row['category_id']) == target for row in existing),
            'QA rehearsal source group has lost its event-only match')
    names = [row['category_name'] for row in groups if str(row['category_id']) == group_id]
    require(len(names) == 1, 'QA rehearsal source category changed')
    policy = {
        'eventTarget': target,
        'groups': {group_id: {'sourceName': names[0], 'target': target, 'targetName': categories[-1]['category_name']}},
        'minimumGroupCounts': {group_id: len(existing)},
        'maxChanges': 2,
    }
    journal_path = RUNS + 'qa-rehearsal-pending.json'
    journal, journal_etag = get(client, bucket, journal_path, optional=True)
    pending = set(json.loads(journal)) if journal else set()
    excluded = set(suppressed_ids(bucket, live)) - pending
    candidate = run_builder(assets, providerCategories=groups, providerStreams=streams, mappings=policy,
                            mode='events', protectedIds=sorted(FREEVIEW), excludedIds=sorted(excluded))
    plan = candidate['plan']
    require(len(plan['additions']) == 2 and not any(plan[key] for key in ('renames', 'removals', 'missing')),
            'QA rehearsal delta differs from the two approved event additions')
    changed = {key: value.encode() for key, value in candidate['assets'].items()}
    require(guide_contract(client, bucket, changed) == guide_contract(client, bucket, assets),
            'QA rehearsal changes existing EPG mappings')
    addition_ids = {row['stream_id'] for row in plan['additions']}
    require([row for row in json.loads(changed[LIVE]) if row['stream_id'] not in addition_ids] == live,
            'QA rehearsal changes existing catalogue rows or order')

    release = release_id()
    manifest = {'parent': expected, 'counts': plan['counts'], 'state': plan['state'],
                'assets': {key: sha(value) for key, value in changed.items()}}
    stage(client, bucket, release, changed, manifest)
    require(active(client, bucket)[1] == etag, 'QA pointer changed during rehearsal staging')
    put_json(client, bucket, journal_path, sorted(addition_ids),
             **({'IfMatch': journal_etag} if journal_etag else {'IfNoneMatch': '*'}))
    register(bucket, plan['additions'])
    switch(client, bucket, pointer, etag, release)
    candidate_pointer, candidate_etag = active(client, bucket)
    rollback(client, bucket, candidate_pointer, candidate_etag, release)
    baseline_pointer, baseline_etag = active(client, bucket)
    require(baseline_pointer['release'] == expected, 'QA rollback readback failed')
    switch(client, bucket, baseline_pointer, baseline_etag, release)
    report({'qa_candidate_active': release, 'qa_baseline_restored_in_rehearsal': expected,
            'added_events': len(addition_ids), 'category_id': target,
            'rollback_verified': True, 'guide': baseline_pointer['epg_release']})



def main():
    import boto3

    parser = argparse.ArgumentParser()
    parser.add_argument('--target', choices=('production', 'qa'), required=True)
    parser.add_argument('--mode', choices=(BASELINE, 'inventory', 'events', 'daily'), default=BASELINE)
    parser.add_argument('--operation', choices=('inspect', 'publish', 'rollback', 'qa-rehearse'), default='inspect')
    parser.add_argument('--expected-release', default='')
    args = parser.parse_args()
    bucket = PROD if args.target == 'production' else QA
    account = os.environ['R2_ACCOUNT_ID']
    require(bool(re.fullmatch(r'[a-f0-9]{32}', account)), 'Invalid R2 account identifier')
    client = boto3.client('s3', endpoint_url=f'https://{account}.r2.cloudflarestorage.com', region_name='auto',
                          aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                          aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'])
    pointer, etag = active(client, bucket)
    if args.operation == 'qa-rehearse':
        rehearse_qa_events(client, bucket, pointer, etag, args.expected_release)
        return
    if args.operation == 'rollback':
        rollback(client, bucket, pointer, etag, args.expected_release)
        return
    output = snapshot(client, bucket, pointer, args.mode)
    if args.operation == 'publish':
        require(output is not None, 'Publishing requires an inventory comparison')
        publish(client, bucket, pointer, etag, output)


if __name__ == '__main__':
    try:
        main()
    except SyncError as error:
        raise SystemExit(f'Catalogue sync stopped: {error}') from None
    except Exception as error:
        # SDK requests and provider JSON errors can include credential-bearing details.
        raise SystemExit(f'Catalogue sync stopped ({type(error).__name__}).') from None
