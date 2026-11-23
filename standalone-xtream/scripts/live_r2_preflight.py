#!/usr/bin/env python3
"""Read-only exact Cloudflare QA R2 release preflight. Never writes to R2."""
import collections
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import xml.etree.ElementTree as ET

import boto3

BUCKET = 'loungetv-xtream-private'
REQUIRED = ['catalog/live_categories.json','catalog/live_all.json','catalog/template.m3u',
            'catalog/by-category/1.json','catalog/by-category/2.json','catalog/by-category/3.json',
            'catalog/by-category/5.json','catalog/by-category/9.json','catalog/by-category/25.json']
FREEVIEW = [900000001, 900000002, 900000003, 900000004, 900000005]

def fetch(client, release, key):
    obj = client.get_object(Bucket=BUCKET, Key=f'releases/{release}/{key}')
    return obj['Body'].read()

def main():
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
    current_obj=client.get_object(Bucket=BUCKET, Key='current.json')
    pointer=json.loads(current_obj['Body'].read())
    release=pointer['release']
    epg_release=pointer.get('epg_release',release)
    print('ACTIVE_QA_RELEASE',release,'EPG_RELEASE',epg_release,'ETAG',current_obj['ETag'])
    with tempfile.TemporaryDirectory() as tmp:
        catalog = Path(tmp) / 'catalog'
        catalog.mkdir()
        content={}
        for path in REQUIRED:
            raw=fetch(client,release,path)
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
        from cleanup_qa_catalog import plan_uk, plan_us
        decisions = plan_uk(by[3])[1] + plan_us(by[5])[1]
        rows_by_id = {row['stream_id']: row for row in rows}
        decisions = [d for d in decisions if rows_by_id[d['hidden_id']].get('epg_channel_id')
                     and rows_by_id[d['hidden_id']]['epg_channel_id'] == rows_by_id[d['keep_id']].get('epg_channel_id')]
        print('CONFIRMED_DUPLICATES', len(decisions))
        print('CLEANUP_KEEPLIST',json.dumps([
            {'group':d['group'],'keep_id':d['keep_id'],
             'hidden_id':d['hidden_id'],'reason':d['reason']}
            for d in decisions], ensure_ascii=False))
        guide=fetch(client,epg_release,'epg/guide.xml.gz')
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
        # This reports the actual active release; archive statistics are not used.
        print('READ_ONLY_PREFLIGHT_PASSED; no R2 objects or pointers changed')

if __name__ == '__main__':
    main()
