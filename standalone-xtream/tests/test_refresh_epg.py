from datetime import datetime, timedelta, timezone
import gzip
import json
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from refresh_epg import build_assets


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 22, 20, 9, 30, tzinfo=timezone.utc)
        self.catalogue = [
            {'stream_id': index + 1, 'epg_channel_id': f'ltv.{index % 2849}'}
            for index in range(14717)
        ]
        self.mappings = [
            {'playlist_index': index, 'channel_name': 'Test channel', 'matched_tvg_id': row['epg_channel_id'],
             'source': 'sample', 'source_id': row['epg_channel_id']}
            for index, row in enumerate(self.catalogue[:3235])
        ]
        self.sources = [{'id': 'sample', 'url': 'https://example.test/guide'}]

    def fixture(self, source, wanted):
        return {
            channel: [(self.now - timedelta(hours=1), self.now + timedelta(hours=1),
                       '<programme><title>Fixture</title></programme>')]
            for channel in wanted
        }

    def test_reuses_only_the_approved_ids_and_aligns_short_epg(self):
        assets, count = build_assets(self.sources, self.mappings, self.catalogue, self.now, self.fixture)
        self.assertEqual(count, 2849)
        self.assertEqual(len(assets), 3236)
        root = ET.fromstring(gzip.decompress(assets['epg/guide.xml.gz']))
        self.assertEqual({c.get('id') for c in root.iter('channel')},
                         {p.get('channel') for p in root.iter('programme')})
        short = json.loads(gzip.decompress(assets['epg/short/1.json']))
        self.assertEqual(short['epg_listings'][0]['epg_id'], self.catalogue[0]['epg_channel_id'])

    def test_refuses_incomplete_sources_or_changed_channel_mapping(self):
        with self.assertRaisesRegex(RuntimeError, 'keeping the active guide'):
            build_assets(self.sources, self.mappings, self.catalogue, self.now, lambda source, wanted: {})
        self.catalogue[0]['epg_channel_id'] = 'ltv.changed'
        with self.assertRaisesRegex(ValueError, 'do not agree'):
            build_assets(self.sources, self.mappings, self.catalogue, self.now, self.fixture)
