"""Validate and privately stage a one-time, authorised VOD metadata export.

Use --snapshot PATH for an existing export, or --export with a configured
read-only PostgreSQL connection (standard PG* environment variables).
Without --stage, no R2 requests or writes are performed. No live/EPG objects
or release pointers are modified, even with --stage.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
BASELINE = (5142, 1641, 48369)


def validate(source, output, expected):
    from refresh import VOD_BUDGET
    if not source.is_file() or not 0 < source.stat().st_size <= VOD_BUDGET:
        raise RuntimeError('Snapshot missing or outside the VOD size budget')
    result = subprocess.run(['node', str(ROOT / 'build.mjs'), str(source), str(output)],
                            capture_output=True, text=True, timeout=300)
    if result.returncode:
        raise RuntimeError('Snapshot failed the catalogue builder')
    counts = json.loads(result.stdout)
    actual = (counts['movie'], counts['series'], counts['episodes'])
    if actual != expected:
        raise RuntimeError(f'Unexpected approved counts: {actual}; expected {expected}')
    total = source.stat().st_size + sum(p.stat().st_size for p in output.rglob('*') if p.is_file())
    if total > VOD_BUDGET:
        raise RuntimeError('Snapshot and compiled release exceed the VOD storage budget')
    return counts


def stage(s3, bucket, source):
    from refresh import read, SEED, POINTER, PREFIX, VOD_BUDGET
    body = source.read_bytes()
    digest = hashlib.sha256(body).hexdigest()
    existing = read(s3, bucket, SEED)
    if existing:
        if hashlib.sha256(existing['Body'].read()).hexdigest() != digest:
            raise RuntimeError('A different approved snapshot already exists; refusing to overwrite')
        return 'Approved snapshot already staged; SHA-256 matches'
    if read(s3, bucket, POINTER):
        raise RuntimeError('An active VOD pointer exists; refusing initial staging')
    used = sum(item['Size'] for page in s3.get_paginator('list_objects_v2').paginate(
        Bucket=bucket, Prefix=PREFIX) for item in page.get('Contents', []))
    if used + len(body) > VOD_BUDGET:
        raise RuntimeError('VOD storage budget would be exceeded')
    s3.put_object(Bucket=bucket, Key=SEED, Body=body, ContentType='application/json',
                  CacheControl='no-store', IfNoneMatch='*')
    stored = read(s3, bucket, SEED)
    if not stored or hashlib.sha256(stored['Body'].read()).hexdigest() != digest:
        raise RuntimeError('Staged snapshot failed SHA-256 readback')
    return 'Approved snapshot staged and verified; release pointers unchanged'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sources = parser.add_mutually_exclusive_group(required=True)
    sources.add_argument('--snapshot', type=Path)
    sources.add_argument('--export', action='store_true')
    parser.add_argument('--stage', action='store_true')
    parser.add_argument('--expected', nargs=3, type=int, metavar=('MOVIES', 'SERIES', 'EPISODES'), default=BASELINE)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='ltv-vod-') as temp:
        root = Path(temp)
        source = args.snapshot
        if args.export:
            source = root / 'snapshot.json'
            env = dict(os.environ)
            env['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=300000'
            with source.open('wb') as out:
                result = subprocess.run(['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-f',
                                         str(ROOT / 'export-approved.sql')], env=env, stdout=out,
                                        stderr=subprocess.DEVNULL, timeout=360)
            if result.returncode:
                raise RuntimeError('Read-only export failed; no catalogue staged')
        counts = validate(source, root / 'release', tuple(args.expected))
        print(json.dumps(counts))
        if args.stage:
            from refresh import storage
            print(stage(storage(), os.environ['LTV_VOD_BUCKET'], source))
        else:
            print('Validation only; no storage changes')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never log connection URLs or third-party error payloads.
        raise SystemExit(str(error) if type(error) is RuntimeError else type(error).__name__) from None
