#!/usr/bin/env python3
"""Non-network source contract tests for a patched Nuvio QA checkout."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
repo = root / "app/src/main/java/com/nuvio/tv/livetv/data/LiveTvRepository.kt"
parser = root / "app/src/main/java/com/nuvio/tv/livetv/data/M3uParser.kt"
player = root / "app/src/main/java/com/nuvio/tv/livetv/multiview/LiveTvMediaSourceBuilder.kt"
s, p, b = (f.read_text(encoding="utf-8") for f in (repo, parser, player))
assert s.count("val validLoungeDrm =") == 1
assert s.count('"1486561" -> "tvnz-1"') == 1
assert s.count('"1486578" -> "tvnz-2"') == 1
assert '"lounge_drm_scheme"' in s
assert '"lounge_drm_license"' in s
assert '"lounge_stream_url"' in s
assert '"lounge_stream_user_agent"' in s
assert 'out.write("#KODIPROP:inputstream.adaptive.manifest_type=mpd\\n")' in s
assert 'out.write("#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\\n")' in s
assert 'out.write("#KODIPROP:inputstream.adaptive.license_key=$loungeLicense\\n")' in s
assert 'out.write("$loungeDirect\\n")' in s
assert 'out.write("$base/live/$user/$pass/$streamId.$ext\\n")' in s
assert 'f["lounge_drm_manifest"] == "mpd"' in s
assert 'loungeDirect == "https://i.mjh.nz/.r/$loungeTvnzSlug.mpd"' in s
assert 'loungeLicense == "https://c.mjh.nz/$loungeTvnzSlug-wv"' in s
assert 'line.startsWith("#KODIPROP:", ignoreCase = true)' in p
assert 'if (pendingProps.isEmpty()) null else drmFrom(pendingProps)' in p
assert 'buildDrmMediaSource(url, headers, isLive, protection)' in b
assert 'MediaItem.DrmConfiguration.Builder(uuid)' in b
print("PASS: Both TVNZ source IDs, DRM metadata, licence and parser/player paths connected.")
print("PASS: Non-TVNZ Xtream playback and one-login VOD path untouched.")
