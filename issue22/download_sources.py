#!/usr/bin/env python3
"""Issue #22: independently download validated XMLTV sources, encrypt before upload."""
import concurrent.futures as cf
import datetime as dt
import gzip, hashlib, json, os, pathlib, struct, tarfile, time, urllib.request
import xml.etree.ElementTree as ET
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT=pathlib.Path(__file__).resolve().parent
OUT=ROOT/'batch-download'
FEEDS=OUT/'feeds'
MAX_BYTES=240*1024*1024
MAX_UNPACKED=1500*1024*1024

def inspect_xml(file):
    with file.open('rb') as fp: gz=fp.read(2)==b'\x1f\x8b'
    opener=gzip.open if gz else open
    channels=programmes=0
    unpacked=0
    class Limited:
        def __init__(self,f): self.f=f
        def read(self,n=-1):
            nonlocal unpacked
            if n is None or n<0:n=65536
            b=self.f.read(min(n,1024*1024));unpacked+=len(b)
            if unpacked>MAX_UNPACKED:raise ValueError('uncompressed XML exceeds 1500 MB')
            return b
        def close(self):pass
    with opener(file,'rb') as f:
        root=None
        for ev,el in ET.iterparse(Limited(f),events=('start','end')):
            if ev=='start' and root is None:
                if el.tag!='tv':raise ValueError('not XMLTV root')
                root=el
            if ev=='end' and el.tag=='channel':channels+=1
            if ev=='end' and el.tag=='programme':programmes+=1
            if ev=='end' and el.tag in ('channel','programme') and root is not None:root.clear()
    if channels==0 or programmes==0:raise ValueError('no channel/programme content')
    return {'guide_channels':channels,'programmes':programmes,'unpacked_bytes':unpacked}

def fetch_source(src):
    name=src['id'];dest=FEEDS/(name+'.xmltv');tmp=dest.with_suffix('.tmp')
    errors=[]
    for attempt in range(1,4):
        try:
            req=urllib.request.Request(src['url'],headers={'User-Agent':'LoungeTV-EPG-Issue22/1.0','Accept-Encoding':'identity'})
            h=hashlib.sha256();size=0
            with urllib.request.urlopen(req,timeout=70) as r,tmp.open('wb') as f:
                while part:=r.read(1024*1024):
                    size+=len(part)
                    if size>MAX_BYTES:raise ValueError('response exceeds 240 MB')
                    h.update(part);f.write(part)
            if size<200:raise ValueError('implausibly small response')
            info=inspect_xml(tmp)
            tmp.replace(dest)
            return {'id':name,'status':'ok','bytes':size,'sha256':h.hexdigest(),'attempts':attempt,**info}
        except Exception as e:
            errors.append(type(e).__name__+': '+str(e)[:220]);tmp.unlink(missing_ok=True)
            if attempt<3:time.sleep(2*attempt)
    return {'id':name,'status':'failed','attempts':3,'errors':errors}

def encrypt_bundle(src,dst,public_key):
    import base64
    aes=os.urandom(32);iv=os.urandom(12)
    public=load_pem_public_key(public_key.read_bytes())
    wrapped=public.encrypt(aes,padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
    header=json.dumps({'version':1,'encryption':'AES-256-GCM+RSA-OAEP-SHA256','nonce':base64.b64encode(iv).decode(),'wrapped_key':base64.b64encode(wrapped).decode()},separators=(',',':')).encode()
    with src.open('rb') as f,dst.open('wb') as g:
        g.write(struct.pack('>I',len(header)));g.write(header)
        en=Cipher(algorithms.AES(aes),modes.GCM(iv)).encryptor()
        while b:=f.read(1024*1024):g.write(en.update(b))
        g.write(en.finalize());g.write(en.tag)
    return dst.stat().st_size

def main():
    sources=json.loads((ROOT/'sources.json').read_text())['sources']
    assert len(sources)==25 and len({x['id'] for x in sources})==25
    FEEDS.mkdir(parents=True,exist_ok=True)
    started=dt.datetime.now(dt.timezone.utc).isoformat()
    print('Downloading all 25 configured sources; no private M3U in runner',flush=True)
    with cf.ThreadPoolExecutor(max_workers=5) as pool:
        results=list(pool.map(fetch_source,sources))
    successes=sum(x['status']=='ok' for x in results)
    for x in results:print(x['id'],x['status'],x.get('bytes',''),x.get('guide_channels',''),flush=True)
    status={'started_utc':started,'completed_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'configured_sources':25,'successful_sources':successes,'failed_sources':25-successes,'results':results}
    (OUT/'source_status.json').write_text(json.dumps(status,indent=2))
    with tarfile.open(OUT/'batch.tar.gz','w:gz',compresslevel=4) as tar:
        tar.add(OUT/'source_status.json',arcname='source_status.json')
        for file in sorted(FEEDS.glob('*.xmltv')):tar.add(file,arcname='feeds/'+file.name)
    size=encrypt_bundle(OUT/'batch.tar.gz',OUT/'encrypted_feeds.bin',ROOT/'runner_public_key.pem')
    (OUT/'batch.tar.gz').unlink()
    print('Encrypted artifact bytes:',size,'successful:',successes,flush=True)
    if successes==0:raise SystemExit('No valid XMLTV downloads; see status')

if __name__=='__main__':main()
