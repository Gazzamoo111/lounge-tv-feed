"""Programme filtering from the verified Lounge TV Issue #22 compiler."""
import datetime as dt
import gzip
import re
import time
import urllib.request
from collections import defaultdict
import xml.etree.ElementTree as ET

PLACEHOLDER = re.compile(r'^\s*(?:no information|no data|no programme|no program|no epg|tba|to be announced|upcoming|off air|sign[ -]?off|no scheduled event|ended)\s*$',re.I)
SYNTHETIC_SOURCE_ID = re.compile(r'(?:^dummy[-._]|\.d\d+$)', re.I)
UTC=dt.timezone.utc


def fetch(src, cache, refresh=False, max_mb=160):
    cache.mkdir(parents=True,exist_ok=True)
    path=cache/(src['id']+'.xmltv')
    if path.exists() and path.stat().st_size>1000 and not refresh and time.time()-path.stat().st_mtime<6*3600:
        return path,'cached'
    req=urllib.request.Request(src['url'],headers={'User-Agent':'LoungeTV-EPG-Compiler/1.0','Accept-Encoding':'identity'})
    part=path.with_suffix('.tmp')
    try:
        with urllib.request.urlopen(req,timeout=80) as r, part.open('wb') as f:
            total=0
            while block:=r.read(1024*1024):
                total+=len(block)
                if total>max_mb*1024*1024:raise RuntimeError('download exceeds size cap')
                f.write(block)
        if part.stat().st_size<1000:raise RuntimeError('suspiciously small file')
        # XMLTV parsing happens after download, and failure never overwrites earlier cache.
        part.replace(path)
        return path,'downloaded'
    except Exception as e:
        part.unlink(missing_ok=True)
        if path.exists() and path.stat().st_size>1000:return path,'stale-cache: '+str(e)[:100]
        return None,'ERROR: '+str(e)[:100]


def open_guide(path):
    with path.open('rb') as f: gz=f.read(2)==b'\x1f\x8b'
    return gzip.open(path,'rb') if gz else open(path,'rb')


def parse_clock(text):
    if not text:return None
    s=text.strip()
    try:
        m=re.match(r'^(\d{14})(?:\s*([+-]\d{4}))?',s)
        if not m:return None
        value=m.group(1)+' '+(m.group(2) or '+0000')
        return dt.datetime.strptime(value,'%Y%m%d%H%M%S %z').astimezone(UTC)
    except ValueError:return None


def read_programmes(path, wanted, now, horizon_hours=72):
    byid=defaultdict(list)
    wanted={cid for cid in wanted if not SYNTHETIC_SOURCE_ID.search(cid)}
    if not wanted:return byid
    low=now-dt.timedelta(hours=4); high=now+dt.timedelta(hours=horizon_hours)
    with open_guide(path) as f:
        root=None
        for event,el in ET.iterparse(f,events=('start','end')):
            if event=='start' and root is None:root=el
            if event=='end' and el.tag=='programme':
                ident=el.attrib.get('channel','')
                if ident in wanted:
                    st=parse_clock(el.attrib.get('start')); en=parse_clock(el.attrib.get('stop'))
                    if st and en and st<high and en>low and st<en and el.findtext('title') and not PLACEHOLDER.match(el.findtext('title').split('\n',1)[0]):
                        byid[ident].append((st,en,ET.tostring(el,encoding='unicode')))
                if root is not None:root.clear()
            elif event=='end' and el.tag=='channel':
                if root is not None:root.clear()
    return byid


def best_program_quality(events, now):
    current=any(a<=now<b for a,b,_ in events)
    upcoming=any(now<a<=now+dt.timedelta(hours=12) for a,b,_ in events)
    # Reject stale 'matched' channels with no current/near-term programmes.
    return (current,upcoming) if (current or upcoming) else (False,False)
