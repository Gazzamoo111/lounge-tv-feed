#!/usr/bin/env python3
"""Owner-approved 20-category QA presentation for Lounge TV's PRIVATE Xtream/R2 seed ZIP.
Retains all 14,717 original IDs, EPG and D1 source seed; hides banner/INFO channels
from the visible API and M3U, not from the protected audit.
No upstream source URL or credential is introduced.
"""
import argparse,collections,hashlib,json,re,zipfile
from pathlib import Path

CATEGORIES=[
 ('🇳🇿 New Zealand',(3,4)),
 ('🇦🇺 Australia',(5,6)),
 ('🇬🇧 UK TV & Entertainment',(11,12,13,17)),
 ('🇬🇧 UK Sports',(21,)),
 ('🇺🇸 US TV & Entertainment',(22,23)),
 ('🇺🇸 US Sports',(20,35)),
 ('🌍 Sports Networks',()),
 ('📺 Streaming Services',(18,)),
 ('🎬 Movie Channels',(7,8,9,10)),
 ('🧸 Kids and Family',(14,)),
 ('🔎 Documentaries and Lifestyle',(15,16)),
 ('📡 FAST TV',()),
 ('🎵 Music',(19,)),
 ('🍿 24/7 Movies',(24,)),
 ('📺 24/7 Series',(25,26)),
 ('😄 24/7 Comedy & Reality',(30,31)),
 ('🎭 24/7 Drama & Crime',(27,28,29)),
 ('📺 24/7 Streaming & OnePlay',(1,2,34)),
 ('🧩 24/7 Kids & Cartoons',(32,33)),
 ('🏆 Live Events',(36,37)),
]
DIVIDER=re.compile(r'^\s*#{2,}')
INFO=re.compile(r'(?<!\w)INFO(?!\w)',re.I)
FAST=re.compile(r'^\s*(?:PRIME|TV)\s*\|',re.I)
LINK=re.compile(r'/(\d+)\.(?:ts|m3u8)$')
GROUP=re.compile(r'group-title="[^"]*"')
SPORTS_NETWORK=re.compile(r'\b(?:ESPN|BEIN|FOX SPORTS|SKY SPORTS|TNT SPORTS|SPORTSNET|NFL NETWORK|NBA TV|CBS SPORTS|NBC SPORTS|NESN|SEC NETWORK|ACC NETWORK|ACCN|EUROSPORT|PREMIER SPORTS|DAZN|SPORTS NETWORK)\b',re.I)
SPORTS_4K=re.compile(r'\b(?:SPORT|ESPN|FOX|TNT|BEIN|NFL|NBA|NHL|MLB|F1|UFC|RACING|NESN|SKY SPORTS)\b',re.I)
MOVIE_4K=re.compile(r'\b(?:CINEMA|MOVIE|FILM|HBO|HOLLYWOOD|CINEMAX)\b',re.I)
BASE_CATEGORY={old:i for i,(_,ids) in enumerate(CATEGORIES,1) for old in ids}
def encode(obj):return (json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n').encode('utf-8')
def hidden_reason(name):
 if DIVIDER.match(name):return 'decorative_divider'
 if INFO.search(name):return 'info_placeholder'
 return ''
def category_for(item):
 source=int(item['category_id']);name=item['name']
 if source==18 and FAST.match(name):return 12
 if source in (11,12,17):
  if source==17 and name.startswith('AU|'):return 2
  if name.startswith(('US|','TV|')):return 5
  if name.startswith('PRIME|'):return 12
 if source==20 and SPORTS_NETWORK.search(name):return 7
 if source==21 and SPORTS_NETWORK.search(name) and name.startswith('PRIME|'):return 7
 if source==35 and name.startswith('UK|'):return 4
 if source==2:
  if SPORTS_4K.search(name):return 7
  if MOVIE_4K.search(name):return 9
 if source==32 and 'ONEPLAY' in name.upper():return 18
 if source not in BASE_CATEGORY:raise ValueError('Unmapped source category '+str(source))
 return BASE_CATEGORY[source]
def main(source_zip:Path,target_zip:Path):
 if source_zip.resolve()==target_zip.resolve():raise ValueError('Never overwrite the original')
 with zipfile.ZipFile(source_zip) as source:
  existing=set(source.namelist())
  base='seed/'
  old=json.loads(source.read(base+'catalog/live_all.json'))
  oldcats=json.loads(source.read(base+'catalog/live_categories.json'))
  if len(old)!=14717 or len(oldcats)!=37:raise ValueError('Unexpected approved master inventory')
  if len({x['stream_id'] for x in old})!=len(old):raise ValueError('Duplicate source ID')
  if set(int(x['category_id']) for x in oldcats)!=set(range(1,38)):raise ValueError('Unknown category IDs')
  if len(CATEGORIES)!=20:raise ValueError('Expected exactly 20 approved categories')
  hidden=[];live=[]
  for item in old:
   target_id=category_for(item);obj={**item,'category_id':str(target_id)}
   reason=hidden_reason(obj['name'])
   if reason:hidden.append({**obj,'hidden_reason':reason,'source_category_id':item['category_id']})
   else:live.append(obj)
  if len(hidden)!=348 or any(x['epg_channel_id'] for x in hidden):raise ValueError('Hidden audit mismatch; stop and inspect')
  live.sort(key=lambda x:(int(x['category_id']),int(x['num'])))
  by=collections.defaultdict(list)
  for pos,item in enumerate(live,1):
   item['num']=pos;by[int(item['category_id'])].append(item)
  if set(by)!=set(range(1,21)):raise ValueError('Empty category')
  tmpl=source.read(base+'catalog/template.m3u').decode('utf-8')
  raw=[x.rstrip('\r') for x in tmpl.splitlines() if x.strip()]
  if len(raw)!=1+2*14717 or not raw[0].startswith('#EXTM3U'):raise ValueError('Invalid original M3U')
  entry={}
  for i in range(1,len(raw),2):
   if not raw[i].startswith('#EXTINF'):raise ValueError('Invalid source EXTINF')
   match=LINK.search(raw[i+1])
   if not match:raise ValueError('Invalid Xtream link')
   sid=int(match.group(1))
   if sid in entry:raise ValueError('Duplicate M3U ID')
   entry[sid]=(raw[i],raw[i+1])
  if set(entry)!={item['stream_id'] for item in old}:raise ValueError('Original stream identity mismatch')
  m3u=[raw[0]]
  for item in live:
   meta,url=entry[item['stream_id']]
   if not GROUP.search(meta):raise ValueError('Missing original group metadata')
   new_group=CATEGORIES[int(item['category_id'])-1][0]
   m3u.extend([GROUP.sub('group-title="'+new_group+'"',meta,count=1),url])
  repl={
   base+'catalog/live_all.json':encode(live),
   base+'catalog/live_categories.json':encode([{'category_id':str(i),'category_name':label,'parent_id':0} for i,(label,_) in enumerate(CATEGORIES,1)]),
   base+'catalog/template.m3u':('\n'.join(m3u)+'\n').encode(),
   base+'catalog/hidden_info.json':encode({'description':'These entries are hidden only from Nuvio. The source playlist and D1 ID inventory remain intact.','items':hidden,'count':len(hidden)}),
   base+'catalog/curation_report.json':encode({
    'version':'issue23-approved-order-v2','original_streams':len(old),
    'visible_streams':len(live),'hidden_info_streams':len(hidden),
    'original_categories':37,'visible_categories':20,
    'epg_ids_changed':0,'stream_ids_changed':0,
    'groups':[{'category_id':i,'name':label,'visible_count':len(by[i])} for i,(label,_) in enumerate(CATEGORIES,1)],
    'known_source_gap':'Original source has only NZ Sky Sport, no general NZ TV. The accepted 20-category order does not invent missing channels.'
   })
  }
  for i in range(1,21):repl[base+f'catalog/by-category/{i}.json']=encode(by[i])
  manifest=json.loads(source.read(base+'manifest.json'))
  manifest.update({'streams':len(live),'source_streams':14717,'categories':20,
                   'hidden_info_streams':len(hidden),'category_curated':'issue23-approved-order-v2',
                   'playlist_epg_ids':sum(bool(x['epg_channel_id']) for x in live)})
  repl[base+'manifest.json']=encode(manifest)
  old_cat_files={f for f in existing if re.fullmatch(r'seed/catalog/by-category/\d+\.json',f)}
  ignore=old_cat_files|{base+'manifest.json',base+'sha256_manifest.json'}
  repl_keys=set(repl)
  hashes={}
  target_zip.parent.mkdir(parents=True,exist_ok=True)
  with zipfile.ZipFile(target_zip,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as target:
   for path in sorted((existing-ignore)|repl_keys):
    if not (path.startswith(base) or path.startswith('quality/')) or '..' in Path(path).parts:
     raise ValueError('Unexpected ZIP path')
    payload=repl[path] if path in repl else source.read(path)
    target.writestr(path,payload)
    if path.startswith(base) and path not in (base+'manifest.json',base+'sha256_manifest.json'):
     hashes[path[len(base):]]=hashlib.sha256(payload).hexdigest()
   target.writestr(base+'sha256_manifest.json',encode(hashes))
 with zipfile.ZipFile(source_zip) as original,zipfile.ZipFile(target_zip) as after:
  for protected in ('epg/guide.xml.gz','stream_ids_seed.sql'):
   if original.read(base+protected)!=after.read(base+protected):raise ValueError('Protected file altered')
  for path in existing:
   if path.startswith(base+'epg/short/') and original.read(path)!=after.read(path):
    raise ValueError('Short EPG was changed')
 return {'categories':20,'visible_streams':len(live),'hidden_info_streams':len(hidden),
         'epg_ids_preserved':sum(bool(x['epg_channel_id']) for x in live),
         'sha256':hashlib.sha256(target_zip.read_bytes()).hexdigest()}
if __name__=='__main__':
 ap=argparse.ArgumentParser()
 ap.add_argument('private_source_zip',type=Path)
 ap.add_argument('private_output_zip',type=Path)
 args=ap.parse_args()
 print(json.dumps(main(args.private_source_zip,args.private_output_zip),indent=2))
