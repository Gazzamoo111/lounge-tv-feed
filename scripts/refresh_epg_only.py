#!/usr/bin/env python3
import gzip,re,urllib.request,xml.etree.ElementTree as ET,subprocess,sys
from datetime import datetime,timedelta,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
DOCS=ROOT/'docs'; M3U=DOCS/'lounge-clean.m3u'; GZ=DOCS/'epg6.xml.gz'; OUT=DOCS/'epg6-live.xml'
URL='https://raw.githubusercontent.com/ferteque/Curated-M3U-Repository/main/epg6.xml.gz'
ids=set(re.findall(r'tvg-id="([^"]+)"',M3U.read_text(encoding='utf-8',errors='ignore')))
req=urllib.request.Request(URL,headers={'User-Agent':'LoungeTV/0.8.6'})
with urllib.request.urlopen(req,timeout=180) as r, open(GZ,'wb') as f:
    while True:
        b=r.read(1024*1024)
        if not b: break
        f.write(b)
def pt(v):
    m=re.match(r'^(\d{14})(?:\s+([+-]\d{4}))?',(v or '').strip())
    if not m:return None
    d=datetime.strptime(m.group(1),'%Y%m%d%H%M%S'); o=m.group(2)
    if o:
        sign=1 if o[0]=='+' else -1
        tz=timezone(sign*timedelta(hours=int(o[1:3]),minutes=int(o[3:5])))
        return d.replace(tzinfo=tz).astimezone(timezone.utc)
    return d.replace(tzinfo=timezone.utc)
now=datetime.now(timezone.utc); lo=now-timedelta(hours=1); hi=now+timedelta(hours=54)
out=ET.Element('tv'); cc=pc=0
with gzip.open(GZ,'rb') as src:
    for _,e in ET.iterparse(src,events=('end',)):
        if e.tag=='channel':
            if e.attrib.get('id','') in ids: out.append(e); cc+=1
            else:e.clear()
        elif e.tag=='programme':
            if e.attrib.get('channel','') not in ids: e.clear(); continue
            a=pt(e.attrib.get('start')); b=pt(e.attrib.get('stop'))
            if a and b and b>=lo and a<=hi: out.append(e); pc+=1
            else:e.clear()
ET.ElementTree(out).write(OUT,encoding='utf-8',xml_declaration=True)
GZ.unlink(missing_ok=True)
print('EPG channels:',cc,'programmes:',pc)
subprocess.run([sys.executable,str(ROOT/'scripts/build_fast_epg.py')],check=True)
