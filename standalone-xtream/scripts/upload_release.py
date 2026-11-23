#!/usr/bin/env python3
"""Upload complete immutable guide/catalogue to private R2; activate only on explicit flag."""
import argparse,concurrent.futures,json,os,pathlib,sys,hashlib

def main():
    p=argparse.ArgumentParser();p.add_argument('seed',type=pathlib.Path);p.add_argument('--release',required=True);p.add_argument('--activate',action='store_true')
    a=p.parse_args();
    if not a.release.startswith('v') or not all(c.isascii() and (c.isalnum() or c in '_-') for c in a.release) or len(a.release)>49:sys.exit('Invalid release ID')
    try:import boto3
    except ImportError:sys.exit('Install boto3: python -m pip install boto3')
    env={k:os.environ.get(k,'') for k in ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET']}
    if not all(env.values()):sys.exit('Missing R2_* environment variables')
    client=boto3.client('s3',endpoint_url=f'https://{env["R2_ACCOUNT_ID"]}.r2.cloudflarestorage.com',region_name='auto',aws_access_key_id=env['R2_ACCESS_KEY_ID'],aws_secret_access_key=env['R2_SECRET_ACCESS_KEY'])
    files=[x for folder in ('catalog','epg') for x in (a.seed/folder).rglob('*') if x.is_file()]
    if len(files)<1000:sys.exit(f'Insufficient private content: only {len(files)} files')
    expected=json.loads((a.seed/'sha256_manifest.json').read_text())
    def upload(path):
        rel=str(path.relative_to(a.seed));raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=expected.get(rel):raise ValueError('File hash mismatch '+rel)
        key=f'releases/{a.release}/{rel}'
        kind='application/xml' if rel.endswith('.xml') else ('application/gzip' if rel.endswith('.gz') else ('audio/x-mpegurl' if rel.endswith('.m3u') else 'application/json'))
        client.put_object(Bucket=env['R2_BUCKET'],Key=key,Body=raw,ContentType=kind,CacheControl='private,max-age=900')
        return len(raw)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        total=sum(pool.map(upload,files))
    print(json.dumps({'uploaded_files':len(files),'bytes':total,'release':a.release,'activated':False}))
    if a.activate:
        # This option must never rewrite current.json without an ETag conditional.
        # The active pointer may also include a separately refreshed epg_release.
        sys.exit('UNSAFE ACTIVATION BLOCKED: perform a conditional QA R2 current.json update preserving existing epg_release; use the Cloudflare release procedure.')
if __name__=='__main__':main()
