# TVNZ 1/2 Widevine in the existing Lounge TV Xtream login (QA)

**Current status:** Gateway QA v22 ACTIVE. The Android QA APK patch is not proven on-device. Do not promote as a playback fix until both TVNZ channels have passed actual Fire TV/Android TV tests.

## Verified root cause

TVNZ 1/2 are protected MPEG-DASH, not plain TS. Upstream M3U supplies `#KODIPROP` for Widevine licences and `#EXTVLCOPT` for the request user agent. Nuvio + IPTV's Xtream importer (`LiveTvRepository.writeXtreamPlaylist`) previously generated only `#EXTINF` plus `/live/.../{stream_id}.ts`, dropping DRM metadata. That made QA gateway's DRM 422 intentional, not a channel outage. A separately imported M3U had not yet established successful device DRM playback either.

The customer's prior BEST TVNZ 1/2 entries (1182157/1182156) were **wrong foreign content**, not alternatives. **Never use them.**

## QA gateway

- Existing Supabase function `n`, QA version 22
- Existing API action `player_api.php?action=get_live_streams`, same account, EPG, catalogue, VOD and channel IDs
- Only MJH NZ sources 900000001 (TVNZ 1) and 900000002 (TVNZ 2) receive opt-in fields:
  - `lounge_drm_scheme` = `widevine`
  - `lounge_drm_manifest` = `mpd`
  - `lounge_drm_license` = upstream licence URI
  - `lounge_stream_url` = upstream DASH manifest URI
  - `lounge_stream_user_agent` = manifest user agent supplied by upstream M3U
- Uses a Widevine-capable player; never decrypts, bypasses DRM or stores license keys.
- Non-TVNZ Xtream JSON is unchanged. Production untouched.

## Client QA

`patch_xtream.py` modifies the public GPL-3.0 Nuvio + IPTV source at a **pinned upstream revision** in GitHub Actions. It fails closed if the Xtream importer changes. When one of the two exact approved Lounge TV stream IDs has all five valid fields, it emits a Kodi-style protected M3U entry instead of a plain Xtream `.ts` URL. All other channels, Xtream VOD, and menus are untouched. APK uses `com.nuvio.livetv.test`, so it does not overwrite the installed app.

Use `.github/workflows/qa-nuvio-tvnz-player.yml` and its artifact only after it succeeds. This workflow does not contain Lounge TV account credentials.

## Device acceptance (required before declaring this fixed)

1. On Fire TV, install the separate QA APK and add **one** Lounge TV QA Xtream login. Choose TV and movies/series.
2. Refresh the source and confirm exactly one TVNZ 1 and one TVNZ 2 under New Zealand, with normal EPG.
3. Play both for >=15 minutes each, switch away/back multiple times and reopen the app, and verify the channel is the actual NZ broadcast, not foreign footage.
4. Check that Sky Sport 1–9 HD BACKUP and VOD still work.
5. If a TVNZ channel fails, get Nuvio's **Settings → Live TV → Help → Start-Up Report**. It redacts login credentials and gives the actual Media3/DRM error. Compare on the *same device and network* using the official MJH Kodi playlist in a known Widevine-compatible player. If both fail, investigate upstream licence, region and device capability. If only Nuvio fails, correct its player/DRM HTTP implementation.
6. No production promotion until repeat tests are stable and rights for redistribution/onboarding are clear.

## Evidence and limitations

- MJH NZ issue #290 (June 2026): TVNZ 1/2 stopped providing non-DRM streams; Kodi-playlist sources use Widevine.
- Nuvio + IPTV issue #30: other DRM channels failed in Nuvio despite working in TiviMate. User-Agent matters; support in source code is not enough.
- Android Media3 Widevine DRM documentation specifies media source, protected stream UUID, licence URI and headers.
- Source-level gateway tests: 51/51 passed. Actual Widevine licence response/decode has not been observed.
