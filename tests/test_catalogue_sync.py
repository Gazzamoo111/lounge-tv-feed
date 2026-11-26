"""Exercise catalogue release ordering without touching Cloudflare."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location(
    'catalogue_sync', Path(__file__).resolve().parents[1] / 'scripts/catalogue-sync.py'
)
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class FakeR2:
    def __init__(self):
        self.pointer = {'release': 'vbaseline', 'epg_release': 'vguide', 'previous_epg_release': 'vprevious'}
        self.etag = 'initial'
        self.mutations = []

    def get_object(self, *, Bucket, Key):
        if Key != sync.POINTER:
            raise AssertionError(Key)
        return {'Body': io.BytesIO(json.dumps(self.pointer).encode()), 'ETag': self.etag}

    def put_object(self, *, Bucket, Key, Body, IfMatch=None, **kwargs):
        if Key == sync.POINTER:
            if IfMatch != self.etag:
                raise RuntimeError('stale ETag')
            self.pointer = json.loads(Body)
            self.etag = 'next'
        self.mutations.append(Key)


class CatalogueReleaseTest(unittest.TestCase):
    def test_provider_diagnostic_preserves_error_code_without_exposing_response(self):
        failure = HTTPError(
            'https://private.example.invalid/player_api.php?password=secret', 530, 'Error', {},
            io.BytesIO(b'<h1>Error <span>1016</span></h1><p>Private upstream details</p>'),
        )
        self.assertEqual(str(sync.provider_http_error(failure, 'get_live_categories')),
                         'BEST inventory get_live_categories returned HTTP 530 (Cloudflare error 1016)')


    def test_switch_and_rollback_preserve_latest_guide(self):
        r2 = FakeR2()
        old = dict(r2.pointer)
        sync.switch(r2, sync.QA, old, r2.etag, 'vcat-sync-1-1')
        self.assertEqual(r2.pointer, {**old, 'release': 'vcat-sync-1-1'})
        r2.pointer['epg_release'] = 'vrefreshedguide'
        r2.pointer['previous_epg_release'] = 'vguide'
        r2.etag = 'fresh'
        with self.assertRaisesRegex(RuntimeError, 'stale ETag'):
            sync.switch(r2, sync.QA, old, 'next', 'vstale')
        baseline_rows = {sync.LIVE: b'[{"stream_id":1,"epg_channel_id":"one"}]'}
        manifest = json.dumps({'parent': 'vbaseline'}).encode()
        with patch.object(sync, 'get', return_value=(manifest, None)), patch.object(
            sync, 'catalogue', return_value=baseline_rows
        ), patch.object(sync, 'active', wraps=lambda *args: (dict(r2.pointer), r2.etag)):
            sync.rollback(r2, sync.QA, dict(r2.pointer), r2.etag, 'vcat-sync-1-1')
        self.assertEqual(r2.pointer, {'release': 'vbaseline', 'epg_release': 'vrefreshedguide',
                                      'previous_epg_release': 'vguide'})

    def test_registration_readback_is_idempotent_and_checks_category(self):
        rows = [{'stream_id': 42, 'category_id': '25', 'epg_channel_id': ''}]
        found = [{'stream_id': 42, 'category_id': 25, 'epg_id': ''}]
        with patch.object(sync, 'd1', side_effect=[[], found, [], found]) as query:
            sync.register(sync.QA, rows)
            sync.register(sync.QA, rows)
        self.assertIn('ON CONFLICT(stream_id) DO NOTHING', query.call_args_list[0].args[1])
        self.assertEqual(query.call_args_list[0].args[2], [42, 25])
        with patch.object(sync, 'd1', side_effect=[[], [{'stream_id': 42, 'category_id': 1, 'epg_id': ''}]]):
            with self.assertRaisesRegex(sync.SyncError, 'registration mismatch'):
                sync.register(sync.QA, rows)

    def test_failed_d1_registration_keeps_last_good_catalogue(self):
        r2 = FakeR2()
        added = [{'stream_id': 42, 'category_id': '25', 'epg_channel_id': ''}]
        plan = {'additions': added, 'renames': [], 'removals': [], 'counts': {}, 'state': {}}
        arguments = ({sync.LIVE: b'[]'}, plan, None, 'policy-tag', [])
        original_pointer = dict(r2.pointer)
        with patch.object(sync, 'get', side_effect=lambda client, bucket, key:
                          (b'{}', 'policy-tag') if key.endswith('policy.json') else (b'{}', 'initial')), patch.object(
            sync, 'active', return_value=(original_pointer, 'initial')
        ), patch.object(sync, 'release_id', return_value='vcat-sync-1-1'), patch.object(
            sync, 'prune'
        ), patch.object(sync, 'stage') as stage, patch.object(
            sync, 'register', side_effect=sync.SyncError('registration mismatch')
        ):
            with self.assertRaisesRegex(sync.SyncError, 'registration mismatch'):
                sync.publish(r2, sync.QA, original_pointer, 'initial', arguments)
        stage.assert_called_once()
        self.assertEqual(r2.pointer, original_pointer)
        self.assertEqual(r2.mutations, [sync.RUNS + 'registered-pending.json'])


if __name__ == '__main__':
    unittest.main()
