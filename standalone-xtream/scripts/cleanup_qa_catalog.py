#!/usr/bin/env python3
"""Guarded, reversible STAGED Cloudflare QA catalogue cleanup.

Never operates on an R2 bucket, production, Supabase, D1 or provider URLs.
Apply ONLY to a checked-out copy of the currently active QA R2 catalog.
Retains hidden stream IDs in immutable earlier R2 releases and the D1 whitelist.
EPG assets and PPV blocks are never edited. Review the report before upload.
"""
import argparse
import collections
import json
from pathlib import Path
import re

GROUP_PPVS = '🏆 Live Sport | Events & PPV'
NZ_PROTECTED = {900000001,900000002,900000003,900000004,900000005}
KNOWN_UK_KEEP = {'BBC ONE':392911,'BBC TWO':30580,'ITV1':30533,'CHANNEL 4':30555,'CHANNEL 5':30554}
QUALITY = re.compile(r'\b(?:HEVC|FHD|FULL HD|UHD|4K|HD|SD|RAW|BACKUP|BK|H264|H265)\b')
REGIONAL = re.compile(r'\b(?:EAST|WEST|NORTH|SOUTH|WALES|SCOT|SCOTLAND|NI|NORTHERN IRELAND|CHANNEL ISLAND|LONDON|MIDLANDS|YORKS|YORKSHIRE|BORDER SCOTLAND|GRANADA|TYNE TEES|WEST COUNTRY|MERIDIAN|ANGLIA)\b')
M3U_LINK = re.compile(r'/live/\{\{USER\}\}/\{\{PASS\}\}/(\d+)\.(?:ts|m3u8|mpd)\s*$')


def normalize(name):
    name=re.sub(r'^\s*(?:UK(?:-NOWTV)?|US|TV|NZ|AU)\s*\|\s*','',name,flags=re.I)
    name=name.replace('ᴿᴬᵂ',' RAW ').upper().replace('&',' AND ')
    name=re.sub(r'[^A-Z0-9+]+',' ',name)
    name=QUALITY.sub(' ',name)
    name=re.sub(r'\s+',' ',name).strip()
    return name


def uk_brand(name):
    n=normalize(name)
    patterns=[(r'^(?:BBC ONE|BBC 1|BBC1)(?:\b|$)','BBC ONE'),
              (r'^(?:BBC TWO|BBC 2|BBC2)(?:\b|$)','BBC TWO'),
              (r'^(?:ITV 1|ITV1)(?:\b|$)','ITV1'),
              (r'^CHANNEL 4(?:\s|$)','CHANNEL 4'),
              (r'^CHANNEL 5(?:\s|$)','CHANNEL 5')]
    if '+1' in n: return None
    for regex,brand in patterns:
        if re.search(regex,n):return brand
    return None


def logical_key(item,region):
    n=normalize(item['name'])
    if region=='US':
        # These are known network aliases, not separate programme networks.
        for a,b in [('HALLMARK CHANNEL','HALLMARK'),('PARAMOUNT NETWORK','PARAMOUNT'),
                    ('COZI TV','COZI'),('REELZCHANNEL','REELZ'),('UPTV','UP TV'),
                    ('SUNDANCETV','SUNDANCE'),('TV ONE','TV ONE'),('BOUNCETV','BOUNCE TV')]:
            if n==a:n=b
        # US Local & Regional TV is outside scope. Generic WEST feeds are reviewable alternates.
        n=re.sub(r'\b(?:WEST|EAST)\b$','',n).strip()
    return n


def priority(item,preferred=None):
    name=item['name'].upper()
    return (1000 if item['stream_id']==preferred else 0,
            90 if item.get('epg_channel_id') else 0,
            -150 if 'ᴿᴬᵂ' in item['name'] or ' RAW' in name else 0,
            -80 if 'HEVC' in name else 0,
            25 if 'FHD' in name else 15 if ' HD' in name else 0,
            -15 if 'BK' in name or 'BACKUP' in name else 0,
            -2 if REGIONAL.search(normalize(item['name'])) else 0,
            -item['stream_id'])


def plan_uk(rows):
    remove=set();decision=[];groups=collections.defaultdict(list)
    for r in rows:
        brand=uk_brand(r['name'])
        if brand:groups[('brand',brand)].append(r)
        else:groups[('alias',logical_key(r,'UK'))].append(r)
    for (kind,key),items in groups.items():
        if len(items)<2:continue
        # Do not mix regional variations outside the owner's five explicitly selected core brands.
        if kind=='alias' and any(REGIONAL.search(normalize(r['name'])) for r in items):continue
        pref=KNOWN_UK_KEEP.get(key)
        winner=max(items,key=lambda r:priority(r,pref))
        for r in items:
            if r is not winner:
                # Distinct regional guide IDs indicate different schedules.
                # Never remove an EPG-bearing channel by name similarity alone.
                source_epg=r.get('epg_channel_id') or ''
                winner_epg=winner.get('epg_channel_id') or ''
                if source_epg and winner_epg and source_epg!=winner_epg:
                    continue
                remove.add(r['stream_id'])
                decision.append({'category':'UK','group':key,'keep_id':winner['stream_id'],
                                 'hidden_id':r['stream_id'],'hidden_name':r['name'],
                                 'reason':'one_primary_network' if kind=='brand' else 'same_logical_channel_quality'})
    return remove,decision


def plan_us(rows):
    remove=set();decision=[];groups=collections.defaultdict(list)
    for r in rows:groups[logical_key(r,'US')].append(r)
    for key,items in groups.items():
        if len(items)<2:continue
        # Distinguish +1 time shifts and separately-branded spinoffs in normalize().
        winner=max(items,key=priority)
        for r in items:
            if r is not winner:
                # US EAST/WEST streams may have independent regional schedules.
                source_epg=r.get('epg_channel_id') or ''
                winner_epg=winner.get('epg_channel_id') or ''
                if source_epg and winner_epg and source_epg!=winner_epg:
                    continue
                remove.add(r['stream_id'])
                decision.append({'category':'US','group':key,'keep_id':winner['stream_id'],
                                 'hidden_id':r['stream_id'],'hidden_name':r['name'],
                                 'reason':'same_network_quality_or_regional_variant'})
    return remove,decision


def reorder_sky(rows):
    # Preserve the first five Freeview overrides and all remaining non-core sport feeds.
    free=[r for r in rows if r['stream_id'] in NZ_PROTECTED]
    assert [r['stream_id'] for r in free]==sorted(NZ_PROTECTED),'NZ Freeview ordering changed'
    raw=[];fhd=[];other=[]
    for r in rows:
        if r['stream_id'] in NZ_PROTECTED:continue
        n=r['name'].upper()
        m=re.search(r'SKY SPORTS? (?:NZ )?(\d)(?:\s|$)',n)
        if m and not re.search(r'(?:POP|SELECT|PL)\b',n):
            (fhd if 'FHD' in n else raw).append((int(m.group(1)),r))
        else:other.append(r)
    raw.sort(key=lambda x:x[0]);fhd.sort(key=lambda x:x[0])
    raw_ids={n for n,_ in raw};fhd_ids={n for n,_ in fhd}
    assert raw_ids=={1,2,3,4,5,6,7,9} and fhd_ids==set(range(1,10)), 'Unexpected Sky Sport sources; review required'
    return free+[r for _,r in raw]+[r for _,r in fhd]+other


def blocks_from_m3u(original):
    lines=original.splitlines(keepends=True);assert lines[0].startswith('#EXTM3U')
    header='';blocks={};i=0
    while i<len(lines) and not lines[i].startswith('#EXTINF'):
        header+=lines[i];i+=1
    while i<len(lines):
        assert lines[i].startswith('#EXTINF'), 'Unexpected M3U block header'
        j=i+1
        while j<len(lines) and not lines[j].startswith('#EXTINF'):j+=1
        block=''.join(lines[i:j]);ids=[int(m.group(1)) for l in lines[i:j] if (m:=M3U_LINK.search(l))]
        assert len(ids)==1 and ids[0] not in blocks, 'M3U stream block identity unsafe'
        blocks[ids[0]]=block;i=j
    return header,blocks


def run(catalog:Path,expected_visible:int=13083,dry_run:bool=True):
    paths=['live_categories.json','live_all.json','template.m3u']+[f'by-category/{i}.json' for i in (1,2,3,5,9,25)]
    original={p:(catalog/p).read_text(encoding='utf-8') for p in paths}
    cats=json.loads(original['live_categories.json']);all_rows=json.loads(original['live_all.json'])
    by={i:json.loads(original[f'by-category/{i}.json']) for i in (1,2,3,5,9,25)}
    assert len(cats)==25 and cats[-1]['category_name']==GROUP_PPVS and str(cats[-1]['category_id'])=='25'
    assert len(all_rows)==expected_visible and len({r['stream_id'] for r in all_rows})==len(all_rows)
    assert len(by[25])==6756 and [r['stream_id'] for r in by[25]]==[r['stream_id'] for r in all_rows if str(r['category_id'])=='25']
    assert len(by[9])==81, '4K UHD source count differs from audited source; stop'
    assert {r['stream_id'] for r in by[1] if r['stream_id'] in NZ_PROTECTED}==NZ_PROTECTED
    assert len(by[2])==64, 'AU category differs from live QA baseline'
    assert sum(len([r for r in all_rows if str(r['category_id'])==str(i)]) for i in (1,2,3,5,9,25))==sum(len(v) for v in by.values())
    header,blocks=blocks_from_m3u(original['template.m3u'])
    assert set(blocks)=={r['stream_id'] for r in all_rows}, 'Catalog and M3U streams differ'
    assert all('ZZ | LIVE SPORTS EVENTS & PPV' not in blocks[r['stream_id']] for r in by[25]), 'Legacy phantom category reappeared'
    keep_uk,decision_uk=plan_uk(by[3]);keep_us,decision_us=plan_us(by[5])
    hide={r['stream_id'] for r in by[9]}|keep_uk|keep_us
    assert not hide.intersection({r['stream_id'] for r in by[25]})
    assert not hide.intersection(NZ_PROTECTED)
    new_by={i: [r for r in rows if r['stream_id'] not in hide] for i,rows in by.items()}
    new_by[1]=reorder_sky(new_by[1])
    # Reconstruct with the exact original row objects, sorting ONLY NZ. No collateral category reorder.
    nz_iter=iter(new_by[1]);new_all=[]
    for row in all_rows:
        if row['stream_id'] in hide:continue
        new_all.append(next(nz_iter) if str(row['category_id'])=='1' else row)
    assert next(nz_iter,None) is None
    new_ids=[r['stream_id'] for r in new_all]
    changed={
        'live_categories.json': json.dumps([c for c in cats if str(c['category_id'])!='9'],ensure_ascii=False,separators=(',',':'))+'\n',
        'live_all.json':json.dumps(new_all,ensure_ascii=False,separators=(',',':'))+'\n',
        'template.m3u':header+''.join(blocks[sid] for sid in new_ids),
        'by-category/1.json':json.dumps(new_by[1],ensure_ascii=False,separators=(',',':'))+'\n',
        'by-category/3.json':json.dumps(new_by[3],ensure_ascii=False,separators=(',',':'))+'\n',
        'by-category/5.json':json.dumps(new_by[5],ensure_ascii=False,separators=(',',':'))+'\n',
        'by-category/9.json':'[]\n',
    }
    assert len(new_ids)==len(all_rows)-len(hide)
    assert len(new_ids)==len(set(new_ids))
    assert [blocks[x] for x in [r['stream_id'] for r in by[25]]]==[blocks[x] for x in new_ids if x in {r['stream_id'] for r in by[25]}]
    assert [r for r in new_all if str(r['category_id'])=='25']==by[25]
    assert [r for r in new_all if str(r['category_id'])=='2']==by[2]
    assert cats[-1]==json.loads(changed['live_categories.json'])[-1]
    assert sum(x.startswith('#EXTINF') for x in changed['template.m3u'].splitlines())==len(new_all)
    assert all(changed['template.m3u'].count('group-title="💎 4K UHD"')==0 for _ in [0])
    touched=[k for k,v in changed.items() if v!=original[k]]
    if not dry_run:
        for name in touched:(catalog/name).write_text(changed[name],encoding='utf-8')
    return {'dry_run':dry_run,'input_streams':len(all_rows),'output_streams':len(new_all),
            'hide_4k':len(by[9]),'hide_uk':len(keep_uk),'hide_us':len(keep_us),
            'uk_before':len(by[3]),'uk_after':len(new_by[3]),
            'us_before':len(by[5]),'us_after':len(new_by[5]),
            'nz_count':len(by[1]),'nz_order_after':[r['stream_id'] for r in new_by[1]],
            'ppv_count':len(by[25]),'ppv_unchanged':True,
            'touched_files':touched,'decisions':decision_uk+decision_us}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog-dir',required=True,type=Path)
    parser.add_argument('--expected-visible',type=int,default=13083)
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--report',type=Path)
    opts=parser.parse_args()
    result=run(opts.catalog_dir,opts.expected_visible,opts.dry_run)
    if opts.report:opts.report.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='decisions'},ensure_ascii=False,indent=2))