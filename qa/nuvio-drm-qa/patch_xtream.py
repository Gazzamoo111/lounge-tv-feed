#!/usr/bin/env python3
"""Build-time, fail-closed QA patch to Nuvio + IPTV Xtream importer.

This preserves a single Xtream login, with no second M3U. It does not decrypt
or bypass protected streams; it passes through public Widevine license metadata.
Only exact TVNZ 1/2 Lounge QA source IDs and MJH URLs are accepted.
"""
from pathlib import Path
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
FILE = ROOT / "app/src/main/java/com/nuvio/tv/livetv/data/LiveTvRepository.kt"
src = FILE.read_text(encoding="utf-8")
original = r'''                        out.write("#EXTINF:-1$attrs,$title\n")
                        out.write("$base/live/$user/$pass/$streamId.$ext\n")'''
replacement = r'''                        out.write("#EXTINF:-1$attrs,$title\n")
                        // Lounge TV QA: preserve Widevine DASH metadata through Xtream
                        // exactly for the two approved Freeview TVNZ streams.
                        // No separate playlist, interception, decrypted keys or proxy.
                        val loungeTvnzSlug = when (streamId) {
                            "1486561" -> "tvnz-1"
                            "1486578" -> "tvnz-2"
                            else -> null
                        }
                        val loungeDirect = f["lounge_stream_url"].orEmpty()
                        val loungeLicense = f["lounge_drm_license"].orEmpty()
                        val loungeAgent = f["lounge_stream_user_agent"]
                            ?.replace('\r', ' ')?.replace('\n', ' ')?.trim().orEmpty()
                        val validLoungeDrm = loungeTvnzSlug != null &&
                            f["lounge_drm_scheme"] == "widevine" &&
                            f["lounge_drm_manifest"] == "mpd" &&
                            loungeDirect == "https://i.mjh.nz/.r/$loungeTvnzSlug.mpd" &&
                            loungeLicense == "https://c.mjh.nz/$loungeTvnzSlug-wv" &&
                            loungeAgent.startsWith("otg/1.5.1")
                        if (validLoungeDrm) {
                            out.write("#EXTVLCOPT:http-user-agent=$loungeAgent\n")
                            out.write("#KODIPROP:inputstream.adaptive.manifest_type=mpd\n")
                            out.write("#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\n")
                            out.write("#KODIPROP:inputstream.adaptive.license_key=$loungeLicense\n")
                            out.write("$loungeDirect\n")
                        } else {
                            out.write("$base/live/$user/$pass/$streamId.$ext\n")
                        }'''
assert src.count(original) == 1, "Xtream writer changed upstream; refusing to patch."
FILE.write_text(src.replace(original, replacement, 1), encoding="utf-8")
assert "val validLoungeDrm" in FILE.read_text(encoding="utf-8")
print("Applied bounded TVNZ Xtream Widevine patch (two channels only).")
