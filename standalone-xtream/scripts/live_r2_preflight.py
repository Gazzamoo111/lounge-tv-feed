#!/usr/bin/env python3
"""Validate the exact Cloudflare QA release and optionally publish the scoped fix."""
import argparse
import collections
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
import unicodedata
from urllib.request import urlopen
import xml.etree.ElementTree as ET

import boto3

from cleanup_qa_catalog import KNOWN_UK_KEEP, QUALITY, blocks_from_m3u, normalize, plan_uk, plan_us, priority, uk_brand
from stage_nz_freeview_epg import prepare

QA_BUCKET = 'loungetv-xtream-private'
PRODUCTION_BUCKET = 'loungetv-xtream-production-private'
QA_PROGRAMME_CUTOFF = datetime(2026, 11, 23, 8, 16, 26, tzinfo=timezone.utc)
PRODUCTION_BASELINE_HASHES = {
    'catalog/template.m3u': '681d5e1173e39664e60ace9c8948f9186bdfae5c989eb3a9c50d2430fc0e9bb7',
    'catalog/by-category/25.json': 'b192870e341f13a42c3cd1fb36a6cef17ae9b406d9f07420b48f4ca9be185899',
    'epg/guide.xml.gz': '348335093597caaa8aa8b46060ff7eaa732873c75cd5f2c78d26ee54fd12d0a4',
}
QA_RELEASE_HASHES = {
    'catalog/template.m3u': 'b879f4e698c076c324be18c6b2d143b9d7f2fd8cde4a14528a1dd31415ea0bc1',
    'epg/guide.xml.gz': 'b7bff32ee1c16c7fcd626a4d22bf1ed0fb621e35b22e397bb23259a0366aaa16',
}
REQUIRED = ['catalog/live_categories.json','catalog/live_all.json','catalog/template.m3u',
            'catalog/by-category/1.json','catalog/by-category/2.json','catalog/by-category/3.json',
            'catalog/by-category/5.json','catalog/by-category/9.json','catalog/by-category/25.json']
FREEVIEW = [900000001, 900000002, 900000003, 900000004, 900000005]
FREEVIEW_GUIDES = dict(zip(FREEVIEW, (
    'mjh-tvnz-1', 'mjh-tvnz-2', 'mjh-three', 'mjh-maori-tv', 'mjh-te-reo',
)))
STATIC_GUIDE = 'https://raw.githubusercontent.com/Gazzamoo111/lounge-tv-player/epg-data/epg/guide.xml'
BASELINE = ('v20261123-deduplicated25-au9', 'v20261123-issue22')
CONFIRMED = {111546, 1458573, 111553, 1458568, 1458569, 1458570, 1458780,
             1458549, 1424873, 111557, 164074, 230678, 1198206}

def fetch(client, bucket, release, key):
    obj = client.get_object(Bucket=bucket, Key=f'releases/{release}/{key}')
    return obj['Body'].read()

def scoped_changes(catalog, guide, decisions, source, now):
    remove = {row['hidden_id'] for row in decisions}
    if remove != CONFIRMED:
        raise ValueError('Confirmed duplicate IDs differ from the approved list')
    guide_path = catalog.parent / 'epg'
    guide_path.mkdir()
    (guide_path / 'guide.xml.gz').write_bytes(guide)
    # Pass only the five previously verified source IDs to the existing matcher.
    wanted = set(FREEVIEW_GUIDES.values())
    selected_source = ET.Element('tv')
    for _, item in ET.iterparse(source, events=('end',)):
        if item.tag in ('channel', 'programme'):
            if item.get('id' if item.tag == 'channel' else 'channel') in wanted:
                selected_source.append(ET.fromstring(ET.tostring(item)))
            item.clear()
    if {x.get('id') for x in selected_source.findall('channel')} != wanted:
        raise ValueError('Legacy guide is missing a Freeview channel')
    source_path = catalog.parent / 'freeview.xml'
    ET.ElementTree(selected_source).write(source_path, encoding='utf-8')
    cat_changes, epg_changes, evidence = prepare(
        catalog, guide_path, source_path, now, guide_ids=FREEVIEW_GUIDES,
    )
    if not all(entry['current'] and entry['next_12h'] for entry in evidence.values()):
        raise ValueError('A Freeview channel lacks current and upcoming programmes')

    for name in ('live_all.json', 'by-category/3.json', 'by-category/5.json'):
        raw = cat_changes.get(name)
        rows = json.loads(raw if raw is not None else (catalog / name).read_bytes())
        visible = [row for row in rows if row['stream_id'] not in remove]
        cat_changes[name] = (json.dumps(visible, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    before_header, before_blocks = blocks_from_m3u((catalog / 'template.m3u').read_text())
    header, blocks = blocks_from_m3u(cat_changes['template.m3u'].decode())
    assert header == before_header and list(blocks) == list(before_blocks)
    for sid in blocks:
        if sid not in FREEVIEW:
            assert blocks[sid] == before_blocks[sid], 'Non-Freeview M3U block changed'
    cat_changes['template.m3u'] = (header + ''.join(block for sid, block in blocks.items() if sid not in remove)).encode()
    visible_rows = json.loads(cat_changes['live_all.json'])
    assert len(visible_rows) == 13070
    assert {row['stream_id'] for row in visible_rows} == set(blocks) - remove
    for category in (1, 3, 5):
        assert json.loads(cat_changes[f'by-category/{category}.json']) == [
            row for row in visible_rows if str(row['category_id']) == str(category)
        ]

    print('SCOPED_RELEASE_VALIDATED', json.dumps({'channels': len(visible_rows), 'removed': len(remove), 'freeview': evidence}))
    return ({f'catalog/{k}': v for k, v in cat_changes.items()},
            {f'epg/{k}': v for k, v in epg_changes.items()})


def catalogue_duplicates(rows):
    confirmed = collections.defaultdict(list)
    names = collections.defaultdict(list)
    for row in rows:
        # Event names recur across broadcasts. Sky Sport fallback and Freeview IDs are protected.
        name = row['name'].upper().replace('ᴿᴬᵂ', ' RAW ')
        if str(row['category_id']) == '25' or row['stream_id'] in FREEVIEW or 'SKY SPORT' in name:
            continue
        normalized = ' '.join(QUALITY.sub(' ', name).split())
        if not normalized:
            continue
        names[normalized].append(row)
        if row.get('epg_channel_id'):
            confirmed[normalized, row['epg_channel_id']].append(row)

    remove = set()
    for group in confirmed.values():
        keeper = max(group, key=priority)
        remove.update(row['stream_id'] for row in group if row is not keeper)
    ambiguous = sum(sum(row['stream_id'] not in remove for row in group) > 1 for group in names.values())
    return remove, ambiguous


UK_REGIONAL_FEED = re.compile(
    r'(?:(?:BBC ONE|BBC TWO|BBC 1|BBC 2|BBC1|BBC2|ITV 1|ITV1) )?'
    r'(?:CHANNEL ISLANDS?|EAST(?: MIDLANDS| YORKSHIRE)?|WEST(?: MIDLANDS| COUNTRY)?|'
    r'NORTH(?: EAST| WEST)?|SOUTH(?: EAST| WEST)?|SCOT(?:LAND)?|WALES|NI|NORTHERN IRELAND|'
    r'LONDON|MIDLANDS|YORKS(?:HIRE)?|BORDER(?: SCOTLAND)?|GRANADA|TYNE TEES|'
    r'MERIDIAN(?: NORTH| SOUTH| WEST)?|ANGLIA(?: EAST| WEST)?|OXFORD|CAMBRIDGE|'
    r'SUSSEX|KENT|WM|EM|N IRELAND|YORKSHIRE EAST|YORKSHIRE WEST|EAST W|'
    r'NORTH EAST AND CAM|YK LI|WEST COUNTRY WEST|SOUTH AND EAST|CENTRAL EAST|CENTRAL WEST)'
)
UK_PREFIX = re.compile(r'^\s*UK(?:-NOWTV)?\s*\|\s*')
UK_STATION_ALIASES = {
    '5ACTION': '5 ACTION',
    'GREAT TV CHANNEL +1': 'GREAT TV +1',
    'MORE4': 'MORE 4',
    'RTE 1': 'RTE ONE',
    'SKY ARTS 1': 'SKY ARTS',
    'STV CENTRAL EAST': 'STV',
    'STV CENTRAL WEST': 'STV',
    'STV NORTH': 'STV',
    'THAT S TV': 'THATS TV',
}


def station_key(row):
    category = str(row['category_id'])
    if category not in {'2', '3', '4', '5', '6', '7', '8', '10', '11', '13', '14', '15', '16', '17'}:
        return None
    name = row['name'].upper()
    if 'SKY SPORT' in name:
        return None
    if category == '3' and UK_PREFIX.match(name):
        base = normalize(name)
        brand = uk_brand(name)
        if brand:
            suffix = re.sub(
                r'^(?:BBC ONE|BBC TWO|BBC 1|BBC 2|BBC1|BBC2|ITV 1|ITV1|CHANNEL 4|CHANNEL 5)\b\s*',
                '', base,
            )
            if not suffix or UK_REGIONAL_FEED.fullmatch(suffix):
                return category, brand
        if base.startswith('ITV '):
            suffix = base.removeprefix('ITV ')
            if UK_REGIONAL_FEED.fullmatch(suffix):
                return category, 'ITV1'
            if suffix.startswith('+1 ') and UK_REGIONAL_FEED.fullmatch(suffix.removeprefix('+1 ')):
                return category, 'ITV 1 +1'
        return category, UK_STATION_ALIASES.get(base, base)
    # Keep market, affiliate, timeshift and language qualifiers outside the explicit UK families.
    base = ' '.join(QUALITY.sub(' ', name.replace('ᴿᴬᵂ', ' RAW ')).split())
    return (category, base) if base else None


def station_duplicates(rows, guide_ids):
    groups = collections.defaultdict(list)
    for row in rows:
        key = station_key(row)
        if key:
            groups[key].append(row)
    decisions = []
    for (category, station), group in groups.items():
        if len(group) < 2:
            continue
        preferred = KNOWN_UK_KEEP.get(station) if category == '3' else None
        keeper = max(group, key=lambda row: (
            row.get('epg_channel_id') in guide_ids,
            priority(row, preferred),
        ))
        decisions.append({
            'category': category, 'station': station, 'keep': keeper['name'],
            'keep_id': keeper['stream_id'],
            'remove': [[row['stream_id'], row['name']] for row in group if row is not keeper],
        })
    return decisions


def remaining_station_groups(rows):
    groups = collections.defaultdict(list)
    for row in rows:
        category = str(row['category_id'])
        name = row['name'].upper()
        if category in {'1', '9', '25'} or row['stream_id'] in FREEVIEW or 'SKY SPORT' in name:
            continue
        # Provider formatting varies between the broadcast and themed categories.
        market_match = re.match(r'^\s*([A-Z]{2,3})(?:-NOWTV)?\s*[|:]\s*', name)
        market = market_match[1] if market_match else ''
        base = name[market_match.end():] if market_match else name
        base = QUALITY.sub(' ', base.replace('ᴿᴬᵂ', ' RAW '))
        base = re.sub(r'(?<=\w)[’\'](?=\w)', '', base)
        base = re.sub(r'[^\w+&]+', ' ', base)
        base = re.sub(r'\s*\+\s*(?=\d)', ' +', base)
        base = ' '.join(base.split())
        if base:
            groups[market, base].append(row)
    return {key: group for key, group in groups.items() if len(group) > 1}


STATION_FOLLOWUP_BASELINE = 'vprod-stations-45149065010-1'
STATION_FOLLOWUP_GUIDE = 'vprod-freeview-45145113439-1'
STATION_FOLLOWUP_KEEPERS = {
    1458754: 30492,
    1261564: 30567,
    1458815: 1905810,
    45235: 1905930,
    1905927: 45251,
    1920892: 1920303,
    1920845: 1919987,
    1069214: 30523,
    1941463: 45610,
    866341: 91768,
    2024017: 1430405,
    2024504: 1430311,
    2023953: 1430204,
    1424877: 887937,
    1424878: 1014213,
    1905936: 30524,
    1905939: 1014233,
    1905951: 30556,
    1905954: 45295,
    45328: 1905890,
    1458753: 1905893,
    1905905: 164073,
    1905902: 164072,
    1905884: 164071,
    1920891: 1920300,
    1920844: 1919984,
    1905942: 45326,
    1944440: 1944272,
    1944406: 1944405,
    1944350: 1944349,
    559548: 478627,
    976593: 1433539,
    1448714: 1433526,
    1942813: 1943572,
    1942775: 1943956,
    1942718: 1942717,
    1943271: 1943895,
    1942604: 1943401,
    1942574: 1944148,
    1943243: 1943808,
    1942500: 1942497,
    1942498: 1944256,
    1942468: 1943368,
    1942460: 1944252,
    1942433: 1941954,
    1942384: 1943358,
    1942370: 1943708,
    1943342: 1942317,
    1943205: 1942285,
    1943188: 1942192,
    1942186: 1942185,
    1943455: 1943454,
    559588: 478592,
    1943883: 1943882,
    1943861: 1943413,
    1943856: 1943855,
    1943849: 1943848,
    1943841: 1943840,
    1943396: 1943395,
    1943805: 1943804,
    1943380: 1943379,
    1943375: 1943374,
    1943776: 1943775,
    1943773: 1943772,
    1943365: 1943364,
    1943727: 1943726,
    1943695: 1943497,
    1944222: 1943661,
    1943323: 1943322,
    978704: 976614,
    976534: 1049066,
    976562: 1041931,
    976644: 1060650,
    1944296: 1944295,
    1944294: 1944293,
    1942171: 1943553,
    1944171: 1944170,
    1944283: 1944282,
    1944162: 1944161,
    1944156: 1944155,
    1942167: 1944057,
    1944122: 1944121,
    1944220: 1944219,
    976542: 1811973,
    1503129: 1414075,
    1503131: 1433175,
    1448718: 1414077,
    1503134: 1414076,
    1503137: 1414078,
    1503139: 1433176,
    1944085: 1943564,
    1944069: 1944068,
    1944065: 1944064,
    1943517: 1943516,
    1943507: 1943506,
    1943502: 1943501,
    1944041: 1944040,
    1458793: 1458804,
}


def followup_removals(rows, guide_ids):
    by_id = {row['stream_id']: row for row in rows}
    removed = set(STATION_FOLLOWUP_KEEPERS)
    keepers = set(STATION_FOLLOWUP_KEEPERS.values())
    if not removed or removed & keepers or not removed | keepers <= by_id.keys():
        raise ValueError('The reviewed station IDs do not match the active catalogue')
    for stream_id, keeper_id in STATION_FOLLOWUP_KEEPERS.items():
        row, keeper = by_id[stream_id], by_id[keeper_id]
        if (str(row['category_id']) in {'1', '9', '25'} or row['stream_id'] in FREEVIEW
                or 'SKY SPORT' in row['name'].upper()):
            raise ValueError(f'Protected station {stream_id}')
        if row.get('epg_channel_id') in guide_ids and keeper.get('epg_channel_id') not in guide_ids:
            if (str(keeper['category_id']) in {'1', '9', '25'} or keeper_id in FREEVIEW
                    or 'SKY SPORT' in keeper['name'].upper()):
                raise ValueError(f'Cannot replace protected keeper {keeper_id}')
            removed.remove(stream_id)
            removed.add(keeper_id)
    return removed


def apply_catalogue_removals(client, bucket, release, catalogue, rows, remove):
    visible = [row for row in rows if row['stream_id'] not in remove]
    if not remove:
        return visible

    def encode(items):
        return (json.dumps(items, ensure_ascii=False, separators=(',', ':')) + '\n').encode()

    affected = {str(row['category_id']) for row in rows if row['stream_id'] in remove}
    for category in affected:
        key = f'catalog/by-category/{category}.json'
        current = json.loads(catalogue[key] if key in catalogue else fetch(client, bucket, release, key))
        category_rows = [row for row in current if row['stream_id'] not in remove]
        assert category_rows == [row for row in visible if str(row['category_id']) == category]
        catalogue[key] = encode(category_rows)
    header, blocks = blocks_from_m3u(catalogue['catalog/template.m3u'].decode())
    assert set(blocks) == {row['stream_id'] for row in rows}
    catalogue['catalog/template.m3u'] = (header + ''.join(block for sid, block in blocks.items() if sid not in remove)).encode()
    catalogue['catalog/live_all.json'] = encode(visible)
    return visible


def audit_full_catalogue(client, bucket, release, catalogue):
    rows = json.loads(catalogue['catalog/live_all.json'])
    remove, ambiguous = catalogue_duplicates(rows)
    visible = [row for row in rows if row['stream_id'] not in remove]
    assert not catalogue_duplicates(visible)[0], 'Confirmed duplicate remained after catalogue pass'
    print('FULL_CATALOGUE_DUPLICATE_AUDIT', json.dumps({
        'checked': len(rows), 'confirmed_removed': len(remove), 'visible': len(visible),
        'unconfirmed_same_name_groups': ambiguous, 'removed_stream_ids': sorted(remove),
    }))
    apply_catalogue_removals(client, bucket, release, catalogue, rows, remove)


BROWSE_BASELINE = 'vprod-stations-45150504093-1'
BROWSE_GUIDE = 'vprod-freeview-45145113439-1'
FEATURED_CHANNELS = {
    '1': r'TVNZ 1;TVNZ 2;THREE;WHAKAATA MAORI;TE REO;SKY SPORT 1;SKY SPORT 2;SKY SPORT 3;SKY SPORT 4;SKY SPORT 5;SKY SPORT 6;SKY SPORT 7;SKY SPORT 8;SKY SPORT 9;SKY SPORT SELECT;SKY OPEN',
    '2': r'CHANNEL 7 HD|CHANNEL 7;CHANNEL 9 SYDNEY|CHANNEL 9 PERTH|CHANNEL 9 HD;CHANNEL 10 (?:SYDNEY|MELBOURNE|PERTH)|NETWORK 10|TEN;ABC (?:TV|HD|SYDNEY|MELBOURNE|NSW|VIC|NATIONAL);SBS ONE|SBS HD|SBS;ABC NEWS;7MATE;7TWO;7FLIX;9GEM;9GO;9LIFE;10 BOLD;10 PEACH;SBS VICELAND;SBS WORLD MOVIES;NITV;ABC KIDS;FOX SPORTS;KAYO',
    '3': r'BBC ONE|BBC 1;BBC TWO|BBC 2;ITV1|ITV 1;CHANNEL 4;CHANNEL 5;SKY ATLANTIC;SKY SHOWCASE;SKY MAX;SKY WITNESS;BBC NEWS;SKY NEWS;COMEDY CENTRAL;E4;ITV 2|ITV2;ITV 3|ITV3;ITV 4|ITV4;DAVE;GOLD;ALIBI;SYFY',
    '4': r'SKY SPORTS MAIN EVENT;SKY SPORTS PREMIER LEAGUE;SKY SPORTS FOOTBALL;SKY SPORTS F1;SKY SPORTS CRICKET;SKY SPORTS GOLF;SKY SPORTS ACTION;SKY SPORTS ARENA;SKY SPORTS NEWS;TNT SPORTS 1;TNT SPORTS 2;TNT SPORTS 3;TNT SPORTS 4;PREMIER SPORTS? 1;PREMIER SPORTS? 2;EUROSPORT 1;EUROSPORT 2;RACING TV|RACING UK;MUTV;LFC',
    '5': r'ABC (?:HD|FHD)|ABC$;CBS (?:HD|FHD)|CBS$;NBC (?:HD|FHD)|NBC$;FOX (?:HD|FHD)|FOX$;PBS;CW;HBO;SHOWTIME;FX;TNT;TBS;USA NETWORK;AMC;BRAVO;CNN;FOX NEWS;MSNBC;BET;COMEDY CENTRAL;DISCOVERY',
    '6': r'ESPN;ESPN 2|ESPN2;FOX SPORTS 1|FS1;FOX SPORTS 2|FS2;CBS SPORTS;NBC SPORTS;NFL NETWORK;NBA TV;MLB NETWORK;NHL NETWORK;GOLF CHANNEL;TENNIS CHANNEL;ESPN U|ESPNU;SEC NETWORK;BIG TEN NETWORK;ACC NETWORK;YES NETWORK;NESN;SPORTSNET;BEIN SPORTS',
    '7': r'ABC;NBC;CBS;FOX;PBS;CW;TELEMUNDO;UNIVISION;NEW YORK;LOS ANGELES;CHICAGO;PHILADELPHIA;DALLAS;SAN FRANCISCO;BOSTON;ATLANTA;SEATTLE;MIAMI;HOUSTON;DENVER',
    '8': r'ESPN;FOX SPORTS;BEIN SPORTS;TNT SPORTS;EUROSPORT;DAZN;SPORTSNET;TSN;SUPERSPORT;NFL NETWORK;NBA TV;MLB NETWORK;NHL NETWORK;GOLF CHANNEL;TENNIS CHANNEL;RACING;UFC;MOTORSPORT;OLYMPIC;CRICKET',
    '10': r'NETFLIX;DISNEY PLUS|DISNEY;PRIME VIDEO|AMAZON PRIME;HBO MAX|MAX;APPLE TV;PARAMOUNT PLUS|PARAMOUNT;HULU;PEACOCK;DISCOVERY PLUS;STAN;BINGE;KAYO;BRITBOX;CRUNCHYROLL;SHUDDER;MUBI;TUBI;PLUTO;ROKU;YOUTUBE',
    '11': r'SKY CINEMA PREMIERE;SKY CINEMA HITS;SKY CINEMA ACTION;SKY CINEMA COMEDY;SKY CINEMA FAMILY;SKY CINEMA DRAMA;SKY CINEMA THRILLER;SKY CINEMA GREATS;FILM 4;HBO;HBO 2;CINEMAX;SHOWTIME;STARZ;TCM;GREAT MOVIES;AMC;LEGEND;MOVIE CHANNEL;FXM',
    '12': r'SKY STORE;CINEMANIA;HOLLYWOOD;ACTION;COMEDY;FAMILY;THRILLER;HORROR;CLASSICS;SCI FI;DISNEY;MARVEL;STAR WARS;NETFLIX;PRIME;HBO;CHRISTMAS',
    '13': r'CARTOON NETWORK;NICKELODEON;DISNEY CHANNEL;DISNEY JUNIOR;NICK JR;CBBC;CBEEBIES;BOOMERANG;PBS KIDS;ABC KIDS;SKY KIDS;NICKTOONS;TEENNICK;UNIVERSAL KIDS;BABY TV;CHUCHU;COCOMELON;BLUEY;PAW PATROL;PEPPA PIG',
    '14': r'DISCOVERY;NATIONAL GEOGRAPHIC|NAT GEO;ANIMAL PLANET;HISTORY;BBC EARTH;BBC FOUR;SKY DOCUMENTARIES;SKY NATURE;SKY HISTORY;SMITHSONIAN;SCIENCE;INVESTIGATION DISCOVERY;TLC;HGTV;FOOD NETWORK;TRAVEL CHANNEL;DISCOVERY SCIENCE;DISCOVERY TURBO;SKY CRIME;CRIME',
    '15': r'PLUTO;TUBI;ROKU;SAMSUNG;PLEX;FREEVEE;XUMO;BBC;CBS NEWS;SKY NEWS;NBC NEWS;REUTERS;TOP GEAR;BAYWATCH;HELLS KITCHEN;MST3K;UNSOLVED MYSTERIES;BOB ROSS;POKEMON;TRANSFORMERS',
    '16': r'MTV;MTV CLASSIC;MTV HITS;MTV LIVE;VH1;VEVO;CMT;TRACE;MUSIC TELEVISION;NOW 70S;NOW 80S;NOW 90S;CLUBLAND;KERRANG;CLASSIC FM;STINGRAY;80S;90S;ROCK;COUNTRY',
    '17': r'AQUARIUM;FIREPLACE;OCEAN;RAIN;NATURE;LOFI|LO FI;SLEEP;MEDITATION;FOREST;BEACH;WATERFALL;SNOW;SPACE;BIRDS;JAZZ;PIANO;YOGA;CALM;RELAX;AMBIENT',
    '18': r'HARRY POTTER;STAR WARS;MARVEL;LORD OF THE RINGS;JAMES BOND;JURASSIC PARK;FAST AND FURIOUS;MISSION IMPOSSIBLE;JOHN WICK;BATMAN;SPIDER MAN;PIRATES OF THE CARIBBEAN;DISNEY;PIXAR;SHREK;ICE AGE;TOY STORY;ROCKY;WILL FERRELL;ADAM SANDLER',
    '19': r'GAME OF THRONES;BREAKING BAD;THE SOPRANOS;THE WIRE;STRANGER THINGS;THE WALKING DEAD;YELLOWSTONE;SUITS;GREY S ANATOMY;HOUSE;THE OFFICE;FRIENDS;THE BIG BANG THEORY;MODERN FAMILY;BROOKLYN NINE NINE;SIMPSONS;FAMILY GUY;NCIS;LOST;DOCTOR WHO',
    '20': r'THE OFFICE;FRIENDS;SEINFELD;THE BIG BANG THEORY;MODERN FAMILY;BROOKLYN NINE NINE;PARKS AND RECREATION;EVERYBODY LOVES RAYMOND;THE FRESH PRINCE;SCHITT S CREEK;CURB YOUR ENTHUSIASM;TOP GEAR;THE GRAND TOUR;MASTERCHEF;HELL S KITCHEN;SURVIVOR;THE AMAZING RACE;RUPAUL;LOVE ISLAND;MARRIED AT FIRST SIGHT',
    '21': r'BREAKING BAD;BETTER CALL SAUL;THE SOPRANOS;THE WIRE;YELLOWSTONE;PEAKY BLINDERS;THE WALKING DEAD;DEXTER;TRUE DETECTIVE;LAW AND ORDER|LAW & ORDER;NCIS;CRIMINAL MINDS;CSI;BOSCH;BLUE BLOODS;PRISON BREAK;THE SHIELD;LUTHER;SHERLOCK;SUPERNATURAL',
    '22': r'NETFLIX ACTION;NETFLIX COMEDY;NETFLIX CRIME;NETFLIX DRAMA;NETFLIX SCI FI;NETFLIX HORROR;HBO;DISNEY;PRIME;APPLE TV;ONEPLAY;PARAMOUNT;HULU;BOSCH;THE GRAND TOUR;STRANGER THINGS;MARVEL;STAR WARS;DC;PIXAR',
    '23': r'BLUEY;PAW PATROL;PEPPA PIG;POKEMON;SPONGEBOB;THE SIMPSONS;FAMILY GUY;RICK AND MORTY;BOB S BURGERS;AMERICAN DAD;TOM AND JERRY;LOONEY TUNES;SCOOBY DOO;TEEN TITANS;AVATAR;DRAGON BALL;NARUTO;ONE PIECE;DUCKTALES;THE SMURFS',
    '24': r'HOME ALONE;THE GRINCH;ELF;THE POLAR EXPRESS;THE SANTA CLAUSE;CHRISTMAS VACATION;THE HOLIDAY;LOVE ACTUALLY;A CHRISTMAS CAROL;MIRACLE ON 34TH STREET;THE NIGHTMARE BEFORE CHRISTMAS;HALLMARK;SKY CINEMA;CHRISTMAS MOVIES;CHRISTMAS MUSIC;CHRISTMAS;SANTA;HOLIDAY;WINTER;DISNEY',
    '25': r'ALL BLACKS;SUPER RUGBY;NRL;STATE OF ORIGIN;UFC;BOXING;FORMULA 1|F1;UEFA CHAMPIONS LEAGUE;PREMIER LEAGUE;FIFA;NBA;NFL;MLB;NHL;AFL;CRICKET;ICC;WIMBLEDON;PGA;WWE',
}


def browse_name(name):
    value = unicodedata.normalize('NFKD', name.upper())
    value = ''.join(ch for ch in value if not unicodedata.combining(ch))
    value = re.sub(r'^\s*(?:[A-Z]{2,5}(?:-NOWTV)?|24/7)\s*[|:]\s*', '', value)
    value = re.sub(r'^\s*24\s*/\s*7\s+', '', value)
    return ' '.join(re.sub(r'[^A-Z0-9+&]+', ' ', value).split())


def alphabetic_key(name):
    return tuple((1, int(part)) if part.isdigit() else (0, part)
                 for part in re.split(r'(\d+)', browse_name(name)))


def order_category(rows, category):
    featured = []
    remaining = {row['stream_id']: row for row in rows}
    names = {sid: browse_name(row['name']) for sid, row in remaining.items()}
    event_placeholders = {
        sid for sid, row in remaining.items()
        if category == '25' and (
            row['name'].lstrip().startswith(('#', '=')) or
            re.search(r'\b(?:DATA|NO SCHEDULED EVENT)\b', names[sid])
        )
    }
    for selector in FEATURED_CHANNELS[category].split(';'):
        pattern = re.compile(r'(?:^| )(?:(?:' + selector + r'))(?= |$)')
        matches = [sid for sid in remaining if sid not in event_placeholders and pattern.search(names[sid]) and not re.search(r'\+\s*1\b', names[sid])]
        if matches:
            sid = min(matches, key=lambda item: (names[item] != selector, len(names[item])))
            featured.append(remaining.pop(sid))
    # Retain the existing editorial order for featured slots without a named match.
    fallback = [sid for sid in remaining if sid not in event_placeholders]
    fallback.extend(sid for sid in remaining if sid in event_placeholders)
    for sid in fallback[:max(0, min(20, len(rows)) - len(featured))]:
        featured.append(remaining.pop(sid))
    return featured + sorted(remaining.values(), key=lambda row: alphabetic_key(row['name']))


def channel_order_changes(client, bucket, release, rows, cats, template):
    grouped = collections.defaultdict(list)
    for row in rows:
        grouped[str(row['category_id'])].append(row)
    header, blocks = blocks_from_m3u(template.decode())
    assert list(blocks) == [row['stream_id'] for row in rows], 'M3U and Xtream baseline order differs'
    assert {str(cat['category_id']) for cat in cats} == set(grouped) == set(FEATURED_CHANNELS)
    reordered = []
    changes = {}

    def encode(items):
        return (json.dumps(items, ensure_ascii=False, separators=(',', ':')) + '\n').encode()

    for cat in cats:
        key = str(cat['category_id'])
        path = f'catalog/by-category/{key}.json'
        original = fetch(client, bucket, release, path)
        assert json.loads(original) == grouped[key]
        ordered = order_category(grouped[key], key)
        positions = sorted(row['num'] for row in grouped[key])
        result = [dict(row, num=position) for row, position in zip(ordered, positions, strict=True)]
        original_by_id = {row['stream_id']: row for row in grouped[key]}
        assert all(row == dict(original_by_id[row['stream_id']], num=row['num']) for row in result)
        assert result[20:] == sorted(result[20:], key=lambda row: alphabetic_key(row['name']))
        print('CHANNEL_ORDER_CATEGORY', json.dumps([key, cat['category_name'], len(result),
            [row['name'] for row in result[:20]], [row['name'] for row in result[20:23]]], ensure_ascii=False))
        reordered.extend(result)
        if result != grouped[key]:
            changes[path] = encode(result)
    assert len(reordered) == len(rows) and {row['stream_id'] for row in reordered} == set(blocks)
    if reordered != rows:
        changes['catalog/live_all.json'] = encode(reordered)
        changes['catalog/template.m3u'] = (header + ''.join(blocks[row['stream_id']] for row in reordered)).encode()
    return changes


def publish(client, bucket, current, pointer, catalogue, guide, *, catalogue_kind='stations'):
    run = os.environ['GITHUB_RUN_ID']
    attempt = os.environ['GITHUB_RUN_ATTEMPT']
    if not run.isdigit() or not attempt.isdigit():
        raise ValueError('Invalid CI release identifier')
    target = 'prod' if bucket == PRODUCTION_BUCKET else 'qa'
    kind = 'freeview' if guide else catalogue_kind
    release = f'v{target}-{kind}-{run}-{attempt}'
    destination = f'releases/{release}/'

    def objects(prefix):
        return {obj['Key']: obj['Size'] for page in client.get_paginator('list_objects_v2').paginate(
            Bucket=bucket, Prefix=prefix) for obj in page.get('Contents', [])}

    if objects(destination):
        raise ValueError('Immutable QA release already exists')
    changes = catalogue | guide
    unchanged = {}
    active_guide = pointer.get('epg_release', pointer['release'])
    sources = {'catalog': pointer['release']}
    if guide:
        sources['epg'] = active_guide
    for scope, prior in sources.items():
        prefix = f'releases/{prior}/'
        unchanged.update({key.removeprefix(prefix): (key, size) for key, size in objects(prefix + scope + '/').items()
                          if key.removeprefix(prefix) not in changes})
    if len(unchanged) + len(changes) < (3000 if guide else 28):
        raise ValueError('The existing QA catalogue or guide is incomplete')

    def copy(entry):
        path, (key, _) = entry
        client.copy_object(Bucket=bucket, Key=destination + path, CopySource={'Bucket': bucket, 'Key': key})

    with ThreadPoolExecutor(max_workers=20) as pool:
        for _ in pool.map(copy, unchanged.items()):
            pass
    for path, raw in changes.items():
        metadata = {'ContentType': 'application/json'}
        if path.endswith('.m3u'):
            metadata = {'ContentType': 'audio/x-mpegurl'}
        elif path.endswith('.xml.gz'):
            metadata = {'ContentType': 'application/gzip'}
        elif path.startswith('epg/short/'):
            metadata['ContentEncoding'] = 'gzip'
        client.put_object(Bucket=bucket, Key=destination + path, Body=raw, IfNoneMatch='*', **metadata)
        if fetch(client, bucket, release, path) != raw:
            raise RuntimeError('Staged object differs from the validated asset')
    expected = {destination + k: size for k, (_, size) in unchanged.items()}
    expected.update({destination + k: len(v) for k, v in changes.items()})
    if objects(destination) != expected:
        raise RuntimeError('Staged release object inventory differs')

    updated = dict(pointer, release=release, epg_release=release if guide else active_guide)
    if guide:
        updated['previous_epg_release'] = active_guide
    client.put_object(Bucket=bucket, Key='current.json', Body=json.dumps(updated).encode(),
                      ContentType='application/json', CacheControl='no-store', IfMatch=current['ETag'])
    active = client.get_object(Bucket=bucket, Key='current.json')
    assert json.load(active['Body']) == updated, 'Live QA pointer did not match the published release'
    print(f'{target.upper()}_RELEASE_ACTIVE', release, 'VERIFIED_OBJECTS', len(expected), 'ROLLBACK', json.dumps(pointer))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage-scoped', action='store_true')
    parser.add_argument('--publish-scoped', action='store_true')
    parser.add_argument('--production', action='store_true')
    stations = parser.add_mutually_exclusive_group()
    stations.add_argument('--stage-stations', action='store_true')
    stations.add_argument('--publish-stations', action='store_true')
    stations.add_argument('--verify-stations', action='store_true')
    stations.add_argument('--audit-remaining', action='store_true')
    stations.add_argument('--publish-remaining', action='store_true')
    stations.add_argument('--verify-remaining', action='store_true')
    stations.add_argument('--stage-order', action='store_true')
    stations.add_argument('--publish-order', action='store_true')
    stations.add_argument('--verify-order', action='store_true')
    args = parser.parse_args()
    bucket = PRODUCTION_BUCKET if args.production else QA_BUCKET
    target = 'PRODUCTION' if args.production else 'QA'
    account = os.environ['R2_ACCOUNT_ID']
    access = os.environ['R2_ACCESS_KEY_ID']
    secret = os.environ['R2_SECRET_ACCESS_KEY']
    if not(account and access and secret):
        raise SystemExit('BLOCKER: R2 read-only QA credentials not configured')
    if len(account) != 32 or len(access) != 32 or len(secret) != 64:
        raise SystemExit(
            f'BLOCKER: invalid QA R2 credential lengths (account={len(account)}, '
            f'access={len(access)}, secret={len(secret)}); expected 32/32/64'
        )
    client = boto3.client('s3', endpoint_url=f'https://{account}.r2.cloudflarestorage.com',
        region_name='auto', aws_access_key_id=access, aws_secret_access_key=secret)
    current_obj=client.get_object(Bucket=bucket, Key='current.json')
    pointer=json.loads(current_obj['Body'].read())
    release=pointer['release']
    epg_release=pointer.get('epg_release',release)
    print(f'ACTIVE_{target}_RELEASE',release,'EPG_RELEASE',epg_release,'ETAG',current_obj['ETag'])
    with tempfile.TemporaryDirectory() as tmp:
        catalog = Path(tmp) / 'catalog'
        catalog.mkdir()
        content={}
        for path in REQUIRED:
            raw=fetch(client,bucket,release,path)
            content[path]=raw
            dest=catalog / path.removeprefix('catalog/')
            dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_bytes(raw)
        cats=json.loads(content['catalog/live_categories.json'])
        rows=json.loads(content['catalog/live_all.json'])
        by={int(k.split('/')[-1].removesuffix('.json')):json.loads(v)
            for k,v in content.items() if '/by-category/' in k}
        ids={r['stream_id'] for r in rows}
        ppv=by[25]
        print('CATEGORIES',len(cats),'CHANNELS',len(rows),'UNIQUE_STREAM_IDS',len(ids),
              'AU',len(by[2]),'UK',len(by[3]),'US',len(by[5]),'4K',len(by[9]),
              'NZ',len(by[1]),'PPV',len(ppv))
        print('CATEGORIES_ORDER',json.dumps([c['category_name'] for c in cats],ensure_ascii=False))
        print('PPV_SHA256',hashlib.sha256(content['catalog/by-category/25.json']).hexdigest())
        print('TEMPLATE_SHA256',hashlib.sha256(content['catalog/template.m3u']).hexdigest())
        print('CURRENT_NZ_EPG_IDS', json.dumps([
            {'id':r['stream_id'],'epg':r.get('epg_channel_id') or ''}
            for r in by[1] if r['stream_id'] in FREEVIEW]))
        assert len(rows)==len(ids),'duplicate stream IDs in current release'
        assert len(ppv)==6756,'PPV changed unexpectedly'
        assert cats[-1]['category_name']=='🏆 Live Sport | Events & PPV', 'PPV not last'
        assert 'ZZ | LIVE SPORTS EVENTS & PPV' not in content['catalog/template.m3u'].decode(), 'ZZ came back'
        decisions = plan_uk(by[3])[1] + plan_us(by[5])[1]
        rows_by_id = {row['stream_id']: row for row in rows}
        decisions = [d for d in decisions if rows_by_id[d['hidden_id']].get('epg_channel_id')
                     and rows_by_id[d['hidden_id']]['epg_channel_id'] == rows_by_id[d['keep_id']].get('epg_channel_id')]
        print('CONFIRMED_DUPLICATES', len(decisions))
        print('CLEANUP_KEEPLIST',json.dumps([
            {'group':d['group'],'keep_id':d['keep_id'],
             'hidden_id':d['hidden_id'],'reason':d['reason']}
            for d in decisions], ensure_ascii=False))
        guide=fetch(client,bucket,epg_release,'epg/guide.xml.gz')
        print('EPG_SHA256',hashlib.sha256(guide).hexdigest())
        prog_by=collections.defaultdict(list)
        guide_ids=set()
        with gzip.GzipFile(fileobj=io.BytesIO(guide),mode='rb') as g:
            for event,item in ET.iterparse(g, events=('end',)):
                if item.tag=='channel':
                    guide_ids.add(item.attrib.get('id',''))
                    item.clear()
                elif item.tag=='programme':
                    cid=item.attrib.get('channel','')
                    st=item.attrib.get('start','')[:14]
                    en=item.attrib.get('stop','')[:14]
                    if st and en:
                        prog_by[cid].append((st,en))
                    item.clear()
        guide_count=sum(len(v) for v in prog_by.values())
        mapped=[r for r in rows if r.get('epg_channel_id') in guide_ids]
        no_guide=[r['stream_id'] for r in rows if r.get('epg_channel_id') and r['epg_channel_id'] not in guide_ids]
        print('EPG_CHANNELS',len(guide_ids),'PROGRAMMES',guide_count,
              'VISIBLE_MAPPED_STREAMS',len(mapped),'UNRESOLVED_GUIDE_REFS',len(no_guide))
        print('EPG_MISSING_NZ',json.dumps([
            r['stream_id'] for r in by[1]
            if r['stream_id'] in FREEVIEW and (not r.get('epg_channel_id') or r['epg_channel_id'] not in guide_ids)
        ]))
        if args.stage_order or args.publish_order or args.verify_order:
            target_ok = release.startswith('vprod-order-') if args.verify_order else release == BROWSE_BASELINE
            if (not args.production or not target_ok or epg_release != BROWSE_GUIDE
                    or len(rows) != 12714 or len(cats) != 24 or len(ppv) != 6756 or by[9]
                    or hashlib.sha256(guide).hexdigest() != QA_RELEASE_HASHES['epg/guide.xml.gz']):
                raise ValueError('Production baseline or protected assets changed before channel ordering')
            changes = channel_order_changes(client, bucket, release, rows, cats, content['catalog/template.m3u'])
            if args.verify_order:
                assert not changes, 'The live catalogue is not in the verified featured and alphabetic order'
                print('CHANNEL_ORDER_LIVE_VERIFIED', release, len(rows), len(cats))
                return
            digest = hashlib.sha256(changes['catalog/template.m3u']).hexdigest()
            print('CHANNEL_ORDER_VALIDATED', len(rows), len(cats), len(changes), digest)
            if args.publish_order:
                publish(client, bucket, current_obj, pointer, changes, {}, catalogue_kind='order')
            return
        if args.audit_remaining:
            if not args.production:
                raise ValueError('Remaining station audit requires production')
            candidates = remaining_station_groups(rows)
            for (market, station), matches in candidates.items():
                print('REMAINING_GROUP', json.dumps([market, station, [
                    [row['stream_id'], row['category_id'], row['name'], row.get('epg_channel_id', '')]
                    for row in matches
                ]]))
            print('REMAINING_AUDIT', len(rows), len(candidates))
            return
        if args.publish_remaining or args.verify_remaining:
            if (not args.production or epg_release != STATION_FOLLOWUP_GUIDE
                    or hashlib.sha256(guide).hexdigest() != QA_RELEASE_HASHES['epg/guide.xml.gz']
                    or len(cats) != 24 or by[9] or len(ppv) != 6756):
                raise ValueError('Production guide or protected catalogue changed')
            if args.verify_remaining:
                if (not release.startswith('vprod-stations-') or release == STATION_FOLLOWUP_BASELINE
                        or any((left in ids) == (right in ids)
                               for left, right in STATION_FOLLOWUP_KEEPERS.items())
                        or remaining_station_groups(rows)
                        or len(rows) != 12812 - len(STATION_FOLLOWUP_KEEPERS)):
                    raise ValueError('Follow-up catalogue did not pass live readback')
                print('REMAINING_RELEASE_VERIFIED', release, len(rows))
                return
            if release != STATION_FOLLOWUP_BASELINE or len(rows) != 12812:
                raise ValueError('Production catalogue drifted before follow-up release')
            remove = followup_removals(rows, guide_ids)
            catalogue = {key: content[key] for key in ('catalog/live_all.json', 'catalog/template.m3u')}
            visible = apply_catalogue_removals(client, bucket, release, catalogue, rows, remove)
            assert len(visible) == len(rows) - len(remove)
            assert not remaining_station_groups(visible)
            print('REMAINING_RELEASE_VALIDATED', json.dumps({'visible': len(visible), 'duplicates_removed': len(remove)}))
            publish(client, bucket, current_obj, pointer, catalogue, {})
            return
        if args.stage_stations or args.publish_stations or args.verify_stations:
            if not args.production:
                raise ValueError('Station consolidation requires the production target')
            groups = station_duplicates(rows, guide_ids)
            remove = {sid for group in groups for sid, _ in group['remove']}
            for group in groups:
                print('STATION_GROUP', json.dumps(group))
            if args.stage_stations:
                print('UK_ENTERTAINMENT_STATIONS', json.dumps([[r['stream_id'], r['name']] for r in by[3]]))
            print('STATION_AUDIT', json.dumps({'checked': len(rows), 'groups': len(groups), 'remove': len(remove)}))
            if args.verify_stations:
                if (not release.startswith('vprod-stations-') or groups or len(cats) != 24
                        or by[9] or any(str(c['category_id']) == '9' for c in cats)
                        or sum(station_key(row) == ('3', 'BBC ONE') for row in rows) != 1):
                    raise ValueError('The active station release did not pass readback')
                return
            if release != 'vprod-freeview-45145113439-1' or epg_release != release:
                raise ValueError('Production catalogue or guide drifted before station release')
            uhd = {row['stream_id'] for row in by[9]}
            assert uhd and not uhd & remove
            assert any(str(c['category_id']) == '9' and c['category_name'].endswith('4K UHD') for c in cats)
            catalogue = {key: content[key] for key in ('catalog/live_all.json', 'catalog/template.m3u')}
            visible = apply_catalogue_removals(client, bucket, release, catalogue, rows, remove | uhd)
            kept_categories = [c for c in cats if str(c['category_id']) != '9']
            catalogue['catalog/live_categories.json'] = (json.dumps(kept_categories, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
            assert not station_duplicates(visible, guide_ids)
            assert sum(station_key(row) == ('3', 'BBC ONE') for row in visible) == 1
            assert json.loads(catalogue['catalog/by-category/9.json']) == []
            assert not any(str(row['category_id']) == '9' for row in visible)
            print('STATION_RELEASE_VALIDATED', json.dumps({
                'visible': len(visible), 'categories': len(kept_categories),
                'duplicates_removed': len(remove), 'uhd_removed': len(uhd),
            }))
            if args.publish_stations:
                publish(client, bucket, current_obj, pointer, catalogue, {})
            return
        if args.production and release.startswith('vprod-freeview-'):
            remaining, ambiguous = catalogue_duplicates(rows)
            assert not remaining, 'Active production catalogue contains a confirmed duplicate'
            print('FULL_CATALOGUE_DUPLICATE_READBACK', json.dumps({
                'checked': len(rows), 'confirmed_remaining': len(remaining),
                'unconfirmed_same_name_groups': ambiguous,
            }))
        if (release, epg_release) == BASELINE or args.stage_scoped or args.publish_scoped:
            if (release, epg_release) != BASELINE or len(rows) != 13083 or len(guide_ids) != 2849:
                raise ValueError('Active QA baseline differs from the approved release')
            if args.production:
                assets = content | {'epg/guide.xml.gz': guide}
                for key, digest in PRODUCTION_BASELINE_HASHES.items():
                    if hashlib.sha256(assets[key]).hexdigest() != digest:
                        raise ValueError(f'Production baseline differs from approved QA input: {key}')
            cutoff = QA_PROGRAMME_CUTOFF if args.production else datetime.now(timezone.utc)
            with urlopen(STATIC_GUIDE, timeout=90) as source:
                replacements = scoped_changes(catalog, guide, decisions, source, cutoff)
            if args.production:
                assets = replacements[0] | replacements[1]
                for key, digest in QA_RELEASE_HASHES.items():
                    if hashlib.sha256(assets[key]).hexdigest() != digest:
                        raise ValueError(f'Staged production asset differs from the verified QA release: {key}')
                now = datetime.now(timezone.utc).timestamp()
                for sid in FREEVIEW:
                    guide_rows = json.loads(gzip.decompress(assets[f'epg/short/{sid}.json']))['epg_listings']
                    if not any(row['start_timestamp'] <= now < row['stop_timestamp'] for row in guide_rows):
                        raise ValueError(f'QA programme snapshot no longer has a current listing for {sid}')
                print('PRODUCTION_QA_HASH_PARITY_VERIFIED')
                audit_full_catalogue(client, bucket, release, replacements[0])
            if args.publish_scoped:
                publish(client, bucket, current_obj, pointer, *replacements)
                return
        print('READ_ONLY_PREFLIGHT_PASSED; no R2 objects or pointers changed')

if __name__ == '__main__':
    main()
