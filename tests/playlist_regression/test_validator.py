from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from xml.etree import ElementTree

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from playlist_regression import FALLBACK, check, coverage, differences, duplicate_analysis
from playlist_regression import parse_m3u, parse_xtream, programme_time, strict_json

NOW = datetime.fromisoformat("2030-01-01T12:00:00+00:00")
M3U = """#EXTM3U x-tvg-url="https://guide.invalid/private-path?token=private-example"
#EXTINF:-1 channel-id="ltv-1" tvg-id="channel.example" group-title="News &amp; More" tvg-logo="https://art.invalid/private-path?sig=private-example",News, Example
#KODIPROP:inputstream.adaptive.license_key=https://license.invalid/private-path
https://stream.invalid/live/private-user/private-password/1.ts?sig=private-example
"""
XML = """<tv><channel id="channel.example"/>
<programme channel="channel.example" start="20300102003000 +1300" stop="20300102013000 +1300"><title>private-title</title></programme>
<programme channel="channel.example" start="20300101123000 +0000" stop="20300101133000 +0000"><title>private-title</title></programme>
</tv>"""
CATEGORIES = [{"category_id": "56", "category_name": "News & More"}]


class ValidatorTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def write(self, name, content):
        path = self.root / name
        path.write_text(content, encoding="utf-8")
        return path

    def test_m3u_preserves_display_commas_and_decodes_attributes(self):
        [row] = parse_m3u(self.write("playlist.m3u", M3U))
        self.assertEqual((row["name"], row["group"], row["transport"]), ("News, Example", "News & More", "ts"))
        self.assertTrue(row["logo"])

    def test_m3u_rejects_duplicate_ids_and_missing_urls(self):
        for text in [M3U + M3U.split("\n", 1)[1], M3U.rsplit("https://stream", 1)[0]]:
            with self.subTest(incomplete=text != M3U + M3U.split("\n", 1)[1]), self.assertRaises(ValueError):
                parse_m3u(self.write("playlist.m3u", text))

    def test_json_rejects_duplicate_properties_and_nonfinite_numbers(self):
        for text in ['{"a":1,"a":2}', '{"a":NaN}']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                strict_json(self.write("streams.json", text))

    def test_503_requires_exact_documented_error(self):
        rows = parse_m3u(self.write("playlist.m3u", M3U))
        self.assertEqual(parse_xtream(CATEGORIES, {"error": FALLBACK}, 503, rows)[1], "503 " + FALLBACK)
        with self.assertRaisesRegex(ValueError, "documented DRM fallback"):
            parse_xtream(CATEGORIES, {"error": "curated_catalogue_unavailable"}, 503, rows)

    def test_xtream_200_matches_ids_names_categories_and_epg(self):
        rows = parse_m3u(self.write("playlist.m3u", M3U))
        streams = [{"stream_id": 1, "name": "News, Example", "category_id": "56",
                    "stream_icon": "https://art.invalid/logo.png", "epg_channel_id": "channel.example"}]
        self.assertEqual(parse_xtream(CATEGORIES, streams, 200, rows)[1], "200 live catalogue")
        for field, value in (("stream_id", 2), ("category_id", "57"), ("epg_channel_id", "wrong.example")):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "differ|Invalid"):
                parse_xtream(CATEGORIES, [{**streams[0], field: value}], 200, rows)

    def test_epg_counts_missing_dangling_and_unscheduled_separately(self):
        [row] = parse_m3u(self.write("playlist.m3u", M3U))
        channels = [row, {**row, "id": "ltv-2", "epg": "ltv-2"}, {**row, "id": "ltv-3", "epg": "missing.example"},
                    {**row, "id": "ltv-4", "group": "99 Sports Event Sources", "epg": ""}]
        invalid = '<programme channel="orphan.example" start="20300101120000" stop="20300101130000 +0000"/>'
        xml = self.write("guide.xml", XML.replace("</tv>", invalid + "</tv>"))
        report = coverage(xml, channels, NOW)
        self.assertEqual((report["eligible"], report["mapped"], report["current"], report["next"]), (3, 1, 1, 1))
        self.assertEqual((report["no_epg_id"], report["missing_xmltv_id"]), (["ltv-2"], ["ltv-3"]))
        self.assertEqual((report["excluded_unscheduled"], report["invalid_xmltv_ids"], report["invalid_timestamps"]), (1, 1, 1))
        self.assertEqual(len(check({"duplicates": {"duplicate_provider_ids": [], "duplicates": []},
                                    "guides": {"primary": report}})), 2)

    def test_xmltv_dates_and_offsets_are_strict(self):
        self.assertEqual(programme_time("20300102010000 +1300"), NOW)
        for value in ["20300101120000", "20300101120000 +1261", "20300132120000 +0000", "20300101120000 +2400"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                programme_time(value)

    def test_xmltv_rejects_malformed_and_internal_entities(self):
        for text in ["<tv><channel></tv>", '<!DOCTYPE tv [<!ENTITY test "data">]><tv/>']:
            with self.subTest(text=text), self.assertRaises((ValueError, ElementTree.ParseError)):
                coverage(self.write("guide.xml", text), [], NOW)

    def test_duplicate_detection_preserves_regional_variants(self):
        rows = [{"id": str(number), "name": name, "group": "News"} for number, name in enumerate(
            ["Network HD", "Network FHD", "Other Sydney", "Other Melbourne", "Unrelated"]
        )]
        annotations = {"0": {"provider": "provider-1"}, "1": {"provider": "provider-1"},
                       "2": {"region": "Sydney", "identity": "Other"},
                       "3": {"region": "Melbourne", "identity": "Other"}}
        result = duplicate_analysis(rows, annotations)
        self.assertEqual(result["duplicates"], [["0", "1"]])
        self.assertEqual(result["duplicate_provider_ids"], [["0", "1"]])
        self.assertEqual(result["regional_variants"], [["2", "3"]])

    def test_diff_explains_category_id_logo_channel_count_and_mapping(self):
        expected = strict_json(Path(__file__).with_name("nz-au.expected.json"))
        changed = deepcopy(expected)
        changed["groups"][0]["id"] = "1"
        changed["counts"].pop(next(iter(changed["counts"])))
        changed["channels"][0]["logo"] = False
        changed["channels"][0]["epg"] = "wrong.example"
        changed["channels"][1]["id"] = "ltv-new"
        result = "\n".join(differences(expected, changed))
        for text in ("category 1", "channel count", "stable IDs removed", "position 2", "logo", "wrong.example"):
            self.assertIn(text, result)

    def test_capture_projects_data_without_urls_or_programme_text(self):
        self.write("playlist.m3u", M3U)
        self.write("guide.xml", XML)
        self.write("categories.json", json.dumps(CATEGORIES))
        self.write("streams.json", json.dumps({"error": FALLBACK, "private": "do-not-retain"}))
        destination = self.root / "capture.json"
        args = [sys.executable, str(Path(__file__).resolve().parents[2] / "scripts/playlist_regression.py"),
                str(self.root), "--profile", "nz-au", "--as-of", NOW.isoformat(), "--stream-status", "503",
                "--capture-private", str(destination), "--revision", "a" * 40, "--origin-version", "37",
                "--guide-branch", "core"]
        result = subprocess.run(args, text=True, capture_output=True, check=True)
        output = destination.read_text() + result.stdout + result.stderr
        for text in ("private-path", "private-user", "private-password", "private-title", "private-example",
                     "https://", "do-not-retain", "license.invalid"):
            self.assertNotIn(text, output)
        self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
        self.assertEqual(subprocess.run(args, capture_output=True).returncode, 1)


if __name__ == "__main__":
    unittest.main()
