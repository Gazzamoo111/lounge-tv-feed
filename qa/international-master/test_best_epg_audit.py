"""Offline checks: the BEST XMLTV audit never needs actual subscriber secrets."""
from datetime import datetime, timedelta, timezone
import importlib.util
import io
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "best_epg_audit", Path(__file__).with_name("best-epg-audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class BestEpgAuditTests(unittest.TestCase):
    def test_normalization_is_strict_enough_to_hold_wrong_ids(self):
        self.assertEqual(audit.norm("FR| France 24 FHD"), audit.norm("France 24"))
        self.assertNotEqual(audit.norm("France 24"), audit.norm("01TV"))
        self.assertNotEqual(audit.norm("Sky Sport 1"), audit.norm("Sky Sport 2"))

    def test_counts_only_current_programmes_and_holds_mismatches(self):
        now = datetime(2026, 11, 19, 1, tzinfo=timezone.utc)
        start = now.strftime("%Y%m%d%H%M%S +0000")
        end = (now + timedelta(hours=1)).strftime("%Y%m%d%H%M%S +0000")
        past = (now - timedelta(days=2)).strftime("%Y%m%d%H%M%S +0000")
        xml = (f'<tv><channel id="france24.fr"><display-name>France 24</display-name></channel>'
               f'<channel id="01tv.fr"><display-name>01TV</display-name></channel>'
               f'<programme channel="france24.fr" start="{start}" stop="{end}">'
               f'<title>Current news</title></programme>'
               f'<programme channel="01tv.fr" start="{past}" stop="{past}">'
               f'<title>Expired</title></programme></tv>')
        selection = [
            {"stream_id": 1, "epg_id": "france24.fr", "name": "FR| France 24 HD"},
            {"stream_id": 2, "epg_id": "01tv.fr", "name": "AR| France 24"},
            {"stream_id": 3, "epg_id": "01tv.fr", "name": "01TV HD"},
            {"stream_id": 4, "epg_id": "notpresent.fr", "name": "Missing"},
        ]
        result, metadata = audit.audit_xmltv(io.BytesIO(xml.encode()), selection, now)
        self.assertEqual(result["selected_sources_with_id"], 4)
        self.assertEqual(result["accepted_identity_and_current_programmes"], 1)
        self.assertEqual(result["held_identity_conflict"], 1)
        self.assertEqual(result["held_missing_programmes"], 1)
        self.assertEqual(result["not_found_in_guide"], 1)
        self.assertEqual(len(metadata), 2)

    def test_gzipped_feed_is_streamed(self):
        import gzip
        source = io.BytesIO(gzip.compress(
            b'<tv><channel id="a"><display-name>A</display-name></channel></tv>'))
        results, _ = audit.audit_xmltv(
            audit.open_xmltv(source),
            [{"stream_id": 1, "epg_id": "a", "name": "A"}])
        self.assertEqual(results["guide_ids_present"], 1)
        self.assertEqual(results["held_missing_programmes"], 1)

    def test_rejects_bad_timestamps(self):
        self.assertIsNone(audit.xmltv_time("20261119120000"))
        self.assertIsNone(audit.xmltv_time("bad"))
        self.assertIsNotNone(audit.xmltv_time("20261119120000 +1300"))


if __name__ == "__main__":
    unittest.main()
