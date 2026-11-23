from datetime import datetime, timedelta, timezone
import gzip
from io import BytesIO
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from refresh_epg import PRODUCTION_BUCKET, build_assets, compile_current


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

    def test_production_reuses_the_immutable_mapping_order_after_curation(self):
        current = {'release': 'vcurated', 'epg_release': 'vapproved'}
        visible = [self.catalogue[2].copy(), self.catalogue[0].copy()]
        objects = {
            'current.json': current,
            'refresh-inputs/Accepted_Sources.json': {'sources': self.sources},
            'refresh-inputs/LoungeTV_EPG_Mappings.json': {'items': self.mappings},
            'refresh-inputs/catalogue-index-baseline.json': self.catalogue,
            'releases/vcurated/catalog/live_all.json': visible,
        }

        class PrivateBucket:
            def get_object(self, *, Bucket, Key):
                if Bucket != PRODUCTION_BUCKET:
                    raise AssertionError('Wrong production bucket')
                return {'Body': BytesIO(json.dumps(objects[Key]).encode()), 'ETag': 'snapshot'}

        with patch('refresh_epg.download_events', side_effect=lambda source, wanted, *_: self.fixture(source, wanted)):
            pointer, etag, assets, count = compile_current(PrivateBucket(), self.now, PRODUCTION_BUCKET)
            self.assertEqual((pointer, etag, count), (current, 'snapshot', 2849))
            self.assertIn('epg/short/3.json', assets)
            visible[0]['epg_channel_id'] = 'ltv.wrong'
            with self.assertRaisesRegex(ValueError, 'visible production catalogue'):
                compile_current(PrivateBucket(), self.now, PRODUCTION_BUCKET)
