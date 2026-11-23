#!/usr/bin/env python3
"""Private offline M3U -> Xtream R2/D1 dataset. Never commit generated artifacts."""
import argparse, base64, csv, datetime as dt, gzip, hashlib, io, json, re, sys, zipfile
from collections import Counter,defaultdict
from pathlib import Path
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

ATTR = re.compile(r'([\w-]+)="([^"]*)"')
XMLTIME = re.compile(r'^(\d{14})\s*([+-]\d{4})?')

def get_dt(value):
    m = XMLTIME.match(value or '')
    if not m: return None
    tz = m.group(2) or '+0000'
    return dt.datetime.strptime(m.group(1)+tz,'%Y%m%d%H%M%S%z').astimezone(dt.timezone.utc)

def dump_json(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')

def sqlq(s):return "'"+str(s).replace("'","''")+"'"

def after_attributes(meta):
    # M3U channel name begins at first comma outside quoted attribute values.
    quote=False
    for index,ch in enumerate(meta):
        if ch=='"':quote=not quote
        elif ch==',' and not quote:return meta[index+1:].strip()
    raise ValueError('EXTINF has no external separator comma')

def build(package, out):
    with zipfile.ZipFile(package) as z:
        master=z.read('LoungeTV_EPG_Matched_Private.m3u').decode('utf-8-sig')
        guide=z.read('LoungeTV_Unified_EPG.xml.gz')
    out.mkdir(parents=True,exist_ok=True)
    lines=[l.rstrip('\r') for l in master.splitlines() if l.strip()]
    if not lines[0].startswith('#EXTM3U'): raise ValueError('Invalid M3U')
    if len(lines)!=29435: raise ValueError('unexpected playlist length')
    entries=[]
    host=None; path_base=None
    for n in range(1,len(lines),2):
        meta,source=lines[n:n+2]
        if not meta.startswith('#EXTINF') or not source.startswith(('https://','http://')):raise ValueError(f'Unexpected pairing at {n}')
        p=urlparse(source)
        seg=p.path.strip('/').split('/')
        if len(seg)!=3 or not seg[-1].isdigit():raise ValueError('Unrecognised source URL shape, refusing to generate access gateway')
        if host is None: host=(p.scheme,p.hostname);path_base=seg[:2]
        if (p.scheme,p.hostname)!=host or seg[:2]!=path_base:raise ValueError('Multiple providers or embedded credential paths detected; must not blindly rewrite URLs')
        if p.query or p.fragment:raise ValueError('Unexpected source URL query')
        attrs=dict(ATTR.findall(meta))
        if ',' not in meta:raise ValueError('Unexpected channel metadata')
        title=after_attributes(meta)
        entries.append({'source':source,'id':int(seg[-1]),'name':title,'group':attrs.get('group-title',''), 'logo':attrs.get('tvg-logo',''), 'epg_id':attrs.get('tvg-id',''), 'raw':meta})
    if len(entries)!=14717 or len({e['id'] for e in entries})!=len(entries):raise ValueError('source stream ID collision')
    groups=list(dict.fromkeys(e['group'] for e in entries))
    if len(groups)!=37:raise ValueError(f'Unexpected group count: {len(groups)}')
    catid={g:i+1 for i,g in enumerate(groups)}
    categories=[{'category_id':str(catid[g]),'category_name':g,'parent_id':0} for g in groups]
    live=[];by_category=defaultdict(list)
    for i,e in enumerate(entries,1):
        ch={'num':i,'name':e['name'],'stream_type':'live','stream_id':e['id'],'stream_icon':e['logo'],'epg_channel_id':e['epg_id'],'added':'0','category_id':str(catid[e['group']]),'custom_sid':'','tv_archive':0,'direct_source':'','tv_archive_duration':0,'is_adult':0,'container_extension':'ts'}
        live.append(ch);by_category[str(catid[e['group']])].append(ch)
    dump_json(out/'catalog/live_categories.json',categories)
    dump_json(out/'catalog/live_all.json',live)
    for c,arr in by_category.items():dump_json(out/f'catalog/by-category/{c}.json',arr)
    # Client M3U is rewritten into Xtream links, never embeds provider credentials.
    m3u=['#EXTM3U url-tvg="{{EPG_URL}}" x-tvg-url="{{EPG_URL}}"']
    for e in entries:
        m3u.append(e['raw'])
        m3u.append(f'{{{{BASE}}}}/live/{{{{USER}}}}/{{{{PASS}}}}/{e["id"]}.ts')
    (out/'catalog/template.m3u').write_text('\n'.join(m3u)+'\n',encoding='utf-8')
    guide_path=out/'epg/guide.xml.gz';guide_path.parent.mkdir(parents=True,exist_ok=True);guide_path.write_bytes(guide)
    # Read only EPG programmes for IDs actually present in the approved M3U.
    ids={e['epg_id'] for e in entries if e['epg_id']}
    programs=defaultdict(list)
    now=dt.datetime.now(dt.timezone.utc)
    with gzip.open(io.BytesIO(guide),'rb') as f:
        for event,node in ET.iterparse(f,events=('end',)):
            if node.tag!='programme':continue
            channel=node.attrib.get('channel','')
            if channel in ids:
                start,stop=get_dt(node.attrib.get('start')),get_dt(node.attrib.get('stop'))
                if start and stop and stop>now-dt.timedelta(hours=3) and start<now+dt.timedelta(days=4):
                    title=node.findtext('title') or ''
                    desc=node.findtext('desc') or ''
                    listing={'id':str(len(programs[channel])+1),'epg_id':channel,
                        'title':base64.b64encode(title.encode()).decode(),
                        'description':base64.b64encode(desc.encode()).decode(),
                        'start':start.strftime('%Y-%m-%d %H:%M:%S'),
                        'end':stop.strftime('%Y-%m-%d %H:%M:%S'),
                        'start_timestamp':int(start.timestamp()),'stop_timestamp':int(stop.timestamp()),
                        'now_playing':int(start<=now<stop),'has_archive':0}
                    programs[channel].append(listing)
            node.clear()
    for e in entries:
        listing=sorted(programs.get(e['epg_id'],[]),key=lambda p:p['start_timestamp'])
        if listing:dump_json(out/f'epg/short/{e["id"]}.json',{'epg_listings':listing[:60]})
    # Prepare the private D1 seed; no provider credentials go into this SQL.
    q=['BEGIN TRANSACTION;','DELETE FROM stream_ids;']
    for start in range(0,len(entries),75):
        part=entries[start:start+75]
        values=','.join(f'({e["id"]},{catid[e["group"]]},{sqlq(e["epg_id"])})' for e in part)
        q.append('INSERT INTO stream_ids(stream_id,category_id,epg_id) VALUES '+values+';')
    q.append('COMMIT;')
    (out/'stream_ids_seed.sql').write_text('\n'.join(q)+'\n',encoding='utf-8')
    allfiles=[p for p in out.rglob('*') if p.is_file()]
    hashes={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in allfiles}
    summary={'streams':len(entries),'categories':len(groups),'playlist_epg_ids':sum(bool(x['epg_id']) for x in entries),'unique_guide_channel_ids':len(programs),'short_epg_objects':sum(bool(programs.get(x['epg_id'])) for x in entries),'all_unique_stream_ids':True,'private_assets':len(allfiles),'master_sha256':hashlib.sha256(master.encode()).hexdigest(),'guide_sha256':hashlib.sha256(guide).hexdigest(),'upstream_shape':'https origin / account username / account password / numeric stream ID (no suffix)', 'catalogue_files':len(allfiles)}
    dump_json(out/'manifest.json',summary)
    dump_json(out/'sha256_manifest.json',hashes)
    # Hard fail if a provider credential or source URL escaped into any output or log.
    creds=path_base
    for p in allfiles:
        if p.suffix in {'.m3u','.json','.sql'}:
            s=p.read_text(encoding='utf-8')
            for credential in creds:
                if credential in s:raise ValueError(f'Provider credential appeared in {p.relative_to(out)}')
            if host[1] in s:raise ValueError('Source host leaked to generated catalogue')
    return summary

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('private_zip',type=Path);ap.add_argument('output_dir',type=Path);args=ap.parse_args()
    print(json.dumps(build(args.private_zip,args.output_dir),indent=2))
