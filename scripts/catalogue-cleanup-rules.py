"""Catalogue-only exclusions scoped to the Lounge TV categories in Issue 36."""
import re
import unicodedata

ESPN = re.compile(r'\bespn(?:\s*[12])?(?!\w)', re.I)
BIG_BROTHER = re.compile(r'\bbig[\s._-]*brother(?=\b|\d)', re.I)
REPLAY = re.compile(r'\b(?:replays?|re\s*-\s*plays?)\b', re.I)
NINE = re.compile(r'^(?:(?:AU|AUS)\s*[|:]\s*)?(?:CHANNEL\s*)?(?:9|NINE)\s+(NATIONAL|SYDNEY|PERTH)\b', re.I)
KIDS = re.compile(r'^(?:US\s*[|:]\s*)?24\s*/\s*7\s+KIDS\s+(1[0-2]|[1-9])(?:\s+(?:RAW|HD|FHD|SD))?$', re.I)


def audited_label(label):
    return unicodedata.normalize('NFKC', label).strip()


def is_nine_sydney(label):
    match = NINE.match(audited_label(label))
    return bool(match and match[1].lower() == 'sydney')


def reason(category, category_name, label):
    label = audited_label(label)
    if category in ('1', '2') and ESPN.search(label):
        return 'ESPN'
    nine = NINE.match(label)
    if category == '2' and nine and nine[1].lower() == 'perth':
        return 'Nine Perth'
    if category == '14' and BIG_BROTHER.search(label):
        return 'Big Brother'
    if category != '25' and re.search(r'\bsports?\b', category_name, re.I) and REPLAY.search(label):
        return 'Replay'
    return None


def kids_identity(row):
    label = audited_label(row['name']).upper()
    match = re.match(r'^([A-Z-]+)\s*[|:]\s*(.+)$', label)
    if not match:
        return None
    market, name = match.groups()
    if market == 'TV':
        # A generic raw feed has no assured region.
        return None
    market = market.removesuffix('-NOWTV')
    name = re.sub(r'\s+(?:RAW|HD|FHD|SD|UHD)$', '', name).strip(' .')
    name = {'NICK JUNIOR': 'NICK JR', 'NICK TOONS': 'NICKTOONS'}.get(name, name)
    return market, name
