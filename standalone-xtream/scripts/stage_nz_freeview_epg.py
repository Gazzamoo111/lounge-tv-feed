#!/usr/bin/env python3
"""Prepare five genuine NZ Freeview guide mappings in an OFFLINE QA staging copy.

Requires a validated freshly downloaded XMLTV (eg NZXMLTV Freeview), never guesses
programme data. A dry run changes nothing. This is NOT a Cloudflare deploy and
not a recurring guide refresh integration; any production refresh must include
these mappings before promotion. No IPTV playback, DRM or account setting edits.
"""
import argparse
import base64
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import gzip
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

TARGET = {
    900000001: ('TVNZ 1', 'loungetv.nz.freeview.1', {'TVNZ 1','TVNZ1'}),
    900000002: ('TVNZ 2', 'loungetv.nz.freeview.2', {'TVNZ 2','TVNZ2'}),
    900000003: ('Three', 'loungetv.nz.freeview.3', {'THREE','TV3'}),
    900000004: ('Whakaata Māori', 'loungetv.nz.freeview.5', {'WHAKAATA MĀORI','WHAKAATA MAORI'}),
    900000005: ('Te Reo', 'loungetv.nz.freeview.10', {'TE REO'}),
}
BLOCK_LINK = re.compile(r'/live/\{\{USER\}\}/\{\{PASS\}\}/(\d+)\.(?:ts|m3u8|mpd)\s*$')
TIME = re.compile(r'^\d{14}\s+[+-]\d{4}$')
FILLER = {'NO DATA', 'NO PROGRAM INFORMATION', 'NO PROGRAMME INFORMATION','TO BE ANNOUNCED','SIGN OFF','OFF AIR','CHANNEL INFORMATION'}


def normal(s):
    return re.sub(r'\s+', ' ', str(s).upper()).strip()


def load_xml(path):
    with path.open('rb') as fd:
        raw = fd.read()
    if raw[:2] == b'\x1f\x8b': raw=gzip.decompress(raw)
    root=ET.fromstring(raw)
    if root.tag != 'tv': raise ValueError('Source is not XMLTV')
    return root


def utc(s):
    if not TIME.fullmatch(s):raise ValueError('XMLTV programme lacks explicit UTC offset: '+str(s))
    return datetime.strptime(s,'%Y%m%d%H%M%S %z').astimezone(timezone.utc)


def select_source(root,now):
    # Match only explicit exact brand aliases from the Freeview channel definitions.
    names=defaultdict(list)
    for channel in root.findall('channel'):
        for el in channel.findall('display-name'):
            names[normal(el.text)].append(channel.attrib['id'])
    by_channel=defaultdict(list)
    for p in root.findall('programme'):
        by_channel[p.attrib.get('channel','')].append(p)
    selected={};evidence={}
    for sid,(name,guide_id,aliases) in TARGET.items():
        ids=set().union(*(names.get(normal(n),[]) for n in aliases))
        if len(ids)!=1:raise ValueError(f'{name}: expected one exact source guide ID; found {len(ids)}')
        source_id=next(iter(ids));valid=[]
        for programme in by_channel[source_id]:
            try: start,stop=utc(programme.attrib['start']),utc(programme.attrib['stop'])
            except (KeyError,ValueError):continue
            title=(programme.findtext('title') or '').strip()
            if start>=stop or normal(title) in FILLER or not title:continue
            if stop<now-timedelta(minutes=30) or start>now+timedelta(days=7):continue
            valid.append((start,stop,programme))
        valid.sort(key=lambda x:(x[0],x[1]))
        current=any(a<=now<b for a,b,_ in valid)
        next_12h=any(now<a<=now+timedelta(hours=12) for a,b,_ in valid)
        if not (current or next_12h):raise ValueError(f'{name}: source has no genuine current or next-12h schedule')
        selected[sid]=(guide_id,source_id,valid)
        evidence[name]={'target_stream_id':sid,'guide_id':guide_id,
                        'current':current,'next_12h':next_12h,'programmes':len(valid)}
    return selected,evidence


def update_m3u(template,selected):
    chunks=template.splitlines(keepends=True)
    target=set(selected);seen=set();out=[];i=0
    while i<len(chunks) and not chunks[i].startswith('#EXTINF'):
        out.append(chunks[i]);i+=1
    while i<len(chunks):
        if not chunks[i].startswith('#EXTINF'):raise ValueError('Unexpected M3U structure')
        j=i+1
        while j<len(chunks) and not chunks[j].startswith('#EXTINF'):j+=1
        block=chunks[i:j]
        ids=[int(m.group(1)) for l in block if (m:=BLOCK_LINK.search(l))]
        if len(ids)!=1:raise ValueError('Invalid M3U block identity')
        if ids[0] in target:
            sid=ids[0];seen.add(sid)
            if not re.search(r'\btvg-id="[^"]*"',block[0]):raise ValueError('Missing tvg-id field')
            old=re.search(r'\btvg-id="([^"]*)"',block[0]).group(1)
            if old and old!=selected[sid][0]:raise ValueError('Existing NZ EPG ID differs; manual review')
            block[0]=re.sub(r'\btvg-id="[^"]*"',f'tvg-id="{selected[sid][0]}"',block[0],count=1)
        out.extend(block);i=j
    if seen!=target:raise ValueError('Missing NZ streams in template')
    return ''.join(out)


def prepare(catalog,epg,freeview_xml,now):
    original_guide=(epg/'guide.xml.gz').read_bytes()
    guide=ET.fromstring(gzip.decompress(original_guide))
    if guide.tag!='tv':raise ValueError('Current guide invalid')
    source=load_xml(freeview_xml);selected,evidence=select_source(source,now)
    for row in guide.findall('channel'):
        if row.attrib.get('id') in {v[0] for v in selected.values()}:
            raise ValueError('NZ guide ID already in active XMLTV. Refuse duplicate')
    cat_files=['live_all.json','by-category/1.json','template.m3u']
    original={name:(catalog/name).read_text('utf-8') for name in cat_files}
    rows=json.loads(original['live_all.json']);nz=json.loads(original['by-category/1.json'])
    ids=set(TARGET)
    if {r['stream_id'] for r in rows if r['stream_id'] in ids}!=ids:raise ValueError('NZ IDs missing from live_all')
    if {r['stream_id'] for r in nz if r['stream_id'] in ids}!=ids:raise ValueError('NZ IDs missing from category 1')
    for group in (rows,nz):
        for row in group:
            sid=row['stream_id']
            if sid not in selected:continue
            prior=row.get('epg_channel_id','')
            if prior and prior!=selected[sid][0]:raise ValueError('NZ ID already mapped differently')
            row['epg_channel_id']=selected[sid][0]
    replacements={
        'live_all.json':(json.dumps(rows,ensure_ascii=False,separators=(',',':'))+'\n').encode(),
        'by-category/1.json':(json.dumps(nz,ensure_ascii=False,separators=(',',':'))+'\n').encode(),
        'template.m3u':update_m3u(original['template.m3u'],selected).encode(),
    }
    short={}
    for sid,(guide_id,source_id,programmes) in selected.items():
        # XMLTV channel definitions must precede programme elements.
        ch=ET.Element('channel',{'id':guide_id})
        guide.insert(len(guide.findall('channel')),ch)
        ET.SubElement(ch,'display-name').text=TARGET[sid][0]
        epg_listings=[]
        for start,stop,original_prog in programmes:
            # Original source programme is parsed XML; no fabricated programme titles.
            copy=ET.fromstring(ET.tostring(original_prog,encoding='utf-8'))
            copy.set('channel',guide_id)
            guide.append(copy)
            if stop<=now or len(epg_listings)>=60:continue
            title=copy.findtext('title') or ''
            desc=copy.findtext('desc') or ''
            epg_listings.append({'id':str(len(epg_listings)+1),'epg_id':guide_id,
                'title':base64.b64encode(title.encode()).decode(),
                'description':base64.b64encode(desc.encode()).decode(),
                'start':start.strftime('%Y-%m-%d %H:%M:%S'),
                'end':stop.strftime('%Y-%m-%d %H:%M:%S'),
                'start_timestamp':int(start.timestamp()),'stop_timestamp':int(stop.timestamp()),
                'has_archive':0})
        short[f'short/{sid}.json']=gzip.compress(json.dumps({'epg_listings':epg_listings},separators=(',',':')).encode(),mtime=0)
    merged=gzip.compress(ET.tostring(guide,encoding='utf-8',xml_declaration=True),mtime=0)
    # Independent parse and integrity checks.
    check=ET.fromstring(gzip.decompress(merged))
    guide_ids={x.attrib['id'] for x in check.findall('channel')}
    if not {v[0] for v in selected.values()}.issubset(guide_ids):raise ValueError('Merged guide missing NZ ids')
    if sum(1 for r in check.findall('channel') if r.attrib.get('id') in {v[0] for v in selected.values()})!=5:
        raise ValueError('Merged XMLTV duplicate NZ channels')
    return replacements,{'guide.xml.gz':merged,**short},evidence


def run(catalog,epg,freeview_xml,now,dry_run=True):
    if now.tzinfo is None:raise ValueError('now must contain timezone')
    if not catalog.exists() or not epg.exists() or not freeview_xml.is_file():raise FileNotFoundError('Missing stage/catalogue/guide/source')
    cats=json.loads((catalog/'live_categories.json').read_text())
    if len(cats) not in (24,25) or not str(cats[0]['category_name']).endswith('New Zealand'):
        raise ValueError('QA category baseline changed')
    replacements,guide,evidence=prepare(catalog,epg,freeview_xml,now)
    if not dry_run:
        for name,raw in replacements.items():(catalog/name).write_bytes(raw)
        for name,raw in guide.items():
            path=epg/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
    return {'dry_run':dry_run,'channel_count':len(TARGET),'evidence':evidence,
            'catalog_files_changed':list(replacements),'epg_files_changed':list(guide),
            'real_nz_data_validated':True,'production_deployed':False}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--catalog-dir',type=Path,required=True)
    p.add_argument('--epg-dir',type=Path,required=True)
    p.add_argument('--freeview-xml',type=Path,required=True)
    p.add_argument('--now',required=True,help='ISO-8601 time with offset, e.g. 2026-11-23T19:00:00+13:00')
    p.add_argument('--apply',action='store_true',help='Explicitly write to the local QA staging copy (never deploys)')
    p.add_argument('--report',type=Path)
    a=p.parse_args();evidence=run(a.catalog_dir,a.epg_dir,a.freeview_xml,datetime.fromisoformat(a.now).astimezone(timezone.utc),not a.apply)
    if a.report:a.report.write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
    print(json.dumps(evidence,ensure_ascii=False,indent=2))