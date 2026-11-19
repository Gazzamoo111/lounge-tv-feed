#!/usr/bin/env python3
"""Read-only live QA contract: compare universal vs legacy M3U and sample Sky.
Existing subscriber credentials stay inside OIDC-authenticated Supabase broker.
"""
import concurrent.futures
import json
import os
import re
import sys
from urllib.request import Request, urlopen
from collections import Counter

URL="https://liqocisegeqzbyuqloql.supabase.co/functions/v1/lounge-international-epg-broker-qa/"
EXPECTED=["New Zealand","Australia","UK & Ireland","USA & Canada",
 "Worldwide Sports","World News","South Asia","Southeast Asia","East Asia",
 "Western Europe","Northern Europe","Southern Europe","Eastern Europe & Balkans",
 "Middle East & North Africa","Sub-Saharan Africa","Latin America & Caribbean",
 "Entertainment & Movies","Kids & Family","Documentaries, Lifestyle & Music",
 "FAST TV","24/7 Channels","Other International","Live Events & PPV"]


def request(name):
    oidc=os.environ.get("LOUNGE_QA_OIDC","")
    if oidc.count(".")!=2:
        raise ValueError("OIDC token missing")
    return Request(URL+name,headers={"Authorization":"Bearer "+oidc,
        "Accept":"application/json,application/x-mpegURL,text/plain,*/*",
        "User-Agent":"Lounge-International-Regional-QA-CI/1.0"})


def fetch(name,limit=8_000_000):
    with urlopen(request(name),timeout=90) as response:
        if response.status!=200:raise ValueError("QA broker upstream status not 200")
        data=response.read(limit+1)
        if len(data)>limit:raise ValueError("QA response over budget")
        return data.decode("utf-8")


def attr(line,key):
    match=re.search(r'(?:^|\s)'+re.escape(key)+r'="([^"]*)"',line)
    return match.group(1) if match else ""


def parse_m3u(body):
    lines=body.splitlines()
    if not lines or not lines[0].startswith("#EXTM3U"):raise ValueError("No EXTM3U")
    channels={}
    groups=Counter()
    current=None
    prefix=[]
    for l in lines[1:]:
        s=l.strip()
        if s.startswith("#EXTINF:"):
            if current is not None:raise ValueError("missing URL before next channel")
            cid=attr(s,"channel-id")
            if not cid or cid in channels:raise ValueError("bad or duplicate channel ID")
            current={"id":cid,"group":attr(s,"group-title"),
                "epg":attr(s,"tvg-id"),"logo":attr(s,"tvg-logo"),
                "display":s.split(",",1)[-1],"extra":[]}
        elif s.startswith("#"):
            if current is not None:current["extra"].append(s)
        elif s:
            if current is None:raise ValueError("orphan stream URL")
            current["url"]=s
            channels[current["id"]]=current
            groups[current["group"]]+=1
            current=None
    if current is not None:raise ValueError("missing final media URL")
    return channels,groups,lines[0]


def stream_target(url):
    return (url.replace("/lounge-international-master-v4-qa/","/lounge-international-SAME/")
    .replace("/lounge-international-regional-qa/","/lounge-international-SAME/"))


def assert_equivalent(legacy,regional):
    old,old_groups,old_header=parse_m3u(legacy)
    new,new_groups,new_header=parse_m3u(regional)
    if set(old)!=set(new):raise ValueError("catalogue IDs differ")
    group_list=list(new_groups)
    if len(group_list)!=23:raise ValueError("regional category count mismatch: "+str(len(group_list)))
    if not all(any(expected in group for expected in EXPECTED) for group in group_list):
        raise ValueError("unknown regional group label(s): "+json.dumps([g for g in group_list if not any(x in g for x in EXPECTED)],ensure_ascii=False))
    if len(old)<14000:raise ValueError("too few channels")
    for k in old:
        a,b=old[k],new[k]
        if a["epg"]!=b["epg"] or a["logo"]!=b["logo"]:
            raise ValueError("EPG or artwork mapping changed at channel ID")
        if stream_target(a["url"])!=stream_target(b["url"]):
            raise ValueError("provider stream URL changed")
        if a["extra"]!=b["extra"]:
            raise ValueError("TVNZ DRM or other M3U player metadata changed")
    if "lounge-international-regional-qa/xmltv.php" not in new_header:
        raise ValueError("wrong EPG URL in regional playlist")
    nz=[v for v in new.values() if "New Zealand" in v["group"]]
    sky=[v for v in nz if re.search(r"SKY SPORT [1-9]\b",v["display"],re.I)]
    if len(sky)<9:raise ValueError("missing primary Sky Sport NZ channels")
    sample=Counter()
    for k,v in new.items():
        if v["group"].count("24/7")>0:sample["247"]+=1
        if "New Zealand" in v["group"]:sample["nz"]+=1
        if "Australia" in v["group"]:sample["au"]+=1
    return {"state":"regional_playlist_contract_passed","channels":len(new),
        "legacy_categories":len(old_groups),"regional_categories":len(new_groups),
        "regional_counts":dict(new_groups),"sky_sport_entries":len(sky),
        "drm_rows_preserved":True,"epg_ids_preserved":True,
        "provider_urls_preserved":True,"universal_category_format":"flat_m3u"}


def sky_probe(channel):
    try:
        raw=fetch("sky-health?channel="+str(channel),limit=20000)
        obj=json.loads(raw)
        safe={"channel":channel,"sources":[]}
        for r in obj.get("results",[]):
            safe["sources"].append({
                k:r.get(k) for k in
                ("quality","http","bytes","ts_sync","hls_manifest","elapsed_ms","error") if k in r
            })
        return safe
    except Exception as exc:
        return {"channel":channel,"error_type":type(exc).__name__}


def main():
    try:
        legacy=fetch("legacy-playlist")
        regional=fetch("regional-playlist")
        report=assert_equivalent(legacy,regional)
        print("REGIONAL_QA "+json.dumps(report,sort_keys=True))
        # Sky probe is diagnostic only; no live-stream playback claims.
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            sky=list(pool.map(sky_probe,range(1,10)))
        print("SKY_SOURCE_PROBE "+json.dumps(sky,sort_keys=True))
    except ValueError as exc:
        # Controlled validation errors never contain credentials or full URLs.
        print("REGIONAL_QA_FAILED contract: "+str(exc),file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:
        print("REGIONAL_QA_FAILED "+type(exc).__name__+"; provider URLs redacted",
              file=sys.stderr)
        raise SystemExit(1)


if __name__=="__main__":
    main()
