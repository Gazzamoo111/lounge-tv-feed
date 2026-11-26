"""Issue 36 targeted catalogue maintenance. Upstream credentials stay in the runner."""
import importlib
import json
import re

sync = importlib.import_module("catalogue-sync")
ESPN = re.compile(r"\bespn\s*(?:2\b|\b)", re.I)
BIG_BROTHER = re.compile(r"\bbig[\s._-]*brother(?=\b|\d)", re.I)
REPLAY = re.compile(r"\b(?:replays?|re\s*-\s*plays?)\b", re.I)
NINE = re.compile(r"\b(?:channel\s*(?:9|nine)|nine|9)\s*[/|:–-]*\s*(?:\b(?:national|sydney|perth|hd|fhd|raw|sd|nsw|wa)\b|$)", re.I)


def targeted_inventory(assets):
    cats = json.loads(assets[sync.CATEGORIES])
    rows = json.loads(assets[sync.LIVE])
    groups = {str(cat['category_id']): cat['category_name'] for cat in cats}
    print(json.dumps({'categories': groups}, ensure_ascii=False), flush=True)
    for cid in ('1', '2', '4', '6', '8', '13', '14', '23'):
        entries = [r for r in rows if str(r['category_id']) == cid]
        if cid in ('1', '2'):
            entries = [r for r in entries if ESPN.search(r['name']) or NINE.search(r['name'])]
        elif cid in ('4', '6', '8'):
            entries = [r for r in entries if REPLAY.search(r['name'])]
        elif cid == '14':
            entries = [r for r in entries if BIG_BROTHER.search(r['name'])]
        elif cid == '23':
            entries = [r for r in entries if re.search(r"\bkids\b", r['name'], re.I)]
        def clean(label):
            return re.sub(r'https?://\S+', '[redacted]', label)[:120]
        print(json.dumps({'category': cid, 'selected_labels': [clean(r['name']) for r in entries],
                          'nine_guide': [[clean(r['name']), clean(r['epg_channel_id'] or '')]
                                         for r in entries if cid == '2' and NINE.search(r['name'])]},
                         ensure_ascii=False), flush=True)


if __name__ == '__main__':
    import boto3
    import os

    try:
        account = os.environ['R2_ACCOUNT_ID']
        assert re.fullmatch('[a-f0-9]{32}', account)
        client = boto3.client('s3', endpoint_url=f'https://{account}.r2.cloudflarestorage.com',
                              aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                              aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'], region_name='auto')
        pointer, _ = sync.active(client, sync.PROD)
        print(json.dumps({'active': pointer}), flush=True)
        targeted_inventory(sync.catalogue(client, sync.PROD, pointer['release']))
    except Exception as error:
        raise SystemExit(f'Catalogue cleanup stopped ({type(error).__name__})') from None
