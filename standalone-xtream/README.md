# Lounge TV | Xtream from private M3U and XMLTV | QA

**Status:** Isolated Cloudflare QA deployed at `https://xtream-qa.loungetv.nz`. Catalogue and guide verified over HTTPS. Provider playback pending.

Customer experience stays Xtream: server URL + username + password. Existing customer-facing connect.loungetv.nz is untouched. No Supabase dependency inside the NEW Worker.

## Data origin

Final private Issue #22 M3U has 14,717 unique numeric stream IDs across 37 original groups. Completed XMLTV has 2,849 unique EPG channel IDs and 187,840 programmes, with 3,235 matched M3U streams (72.88% verified now-or-next on the source snapshot). Do not commit the private M3U, provider source credentials, XMLTV or customer data to this public repository.

Use the private source ZIP and offline build scripts delivered in the ChatGPT handoff to generate R2 objects:
- catalog/live_categories.json
- catalog/live_all.json
- catalog/by-category/<category-id>.json
- catalog/template.m3u (credential-sanitized, dynamically reissued at login)
- epg/guide.xml.gz
- epg/short/<stream-id>.json for 3,235 matched channels
- stream_ids_seed.sql for the independent D1 database.

QA uses private Standard R2 `loungetv-xtream-private`, separate D1 `loungetv-accounts` and the Worker version recorded in [the current state](../ops/CURRENT_STATE.md). The Worker uses secrets `AUTH_PEPPER` and `PROVIDER_AES_KEY_BASE64`. Playback accepts an authorised HTTPS `UPSTREAM_ORIGIN` by default. This isolated QA Worker additionally allows the approved BEST **HTTP** origin when `ALLOW_HTTP_UPSTREAM="true"` is set in its QA Wrangler vars. Keep the client-facing Xtream API on HTTPS. Set `UPSTREAM_ORIGIN` to the exact origin (scheme, host, port) of the previously working private master M3U, then provision the account with its authorised matching provider line; verify the stream URL pattern and numeric IDs against that master. Do not assume HTTP redirect playback works in Nuvio until tested on-device; do not enable this HTTP opt-in on production without separate acceptance. Encrypt assigned provider credentials through `provision_account.mjs`. Keep query strings and paths containing logins out of diagnostics. Request logging and preview URLs are disabled.

Activate immutable guide/catalogue releases by writing R2 current.json with {"release":"v<identifier>"} only after uploading all releases/v<identifier>/catalog and epg objects and applying the D1 permitted stream IDs seed. Keep previous immutable releases for rollback. Customer credentials do not change when the guide updates.

## Xtream routes

- /player_api.php?username=...&password=...
- /player_api.php?...&action=get_live_categories
- /player_api.php?...&action=get_live_streams
- /player_api.php?...&action=get_short_epg&stream_id=...
- /xmltv.php?... (standard uncompressed XMLTV streaming from private gzip)
- /get.php?... (live M3U with url-tvg metadata)
- /live/<username>/<password>/<stream_id>.ts (validated per-account provider redirect)
- /health

VOD and series are intentionally empty in this LIVE TV-only prototype. Redirects reveal that customer's own upstream line to the player, so supplier-specific per-customer credentials and verified bouquet assignment are required.

## Testing and production gates

Run `node --test standalone-xtream/tests/worker.test.mjs` and `python -m unittest discover -s standalone-xtream/tests -p 'test_*.py'`. Public HTTP verification covered the complete real catalogue, M3U, XMLTV, short EPG, expiry and revocation. The QA login supports catalogue and guide testing. See [migration gates](docs/MIGRATION_GATES.md) for playback and cutover acceptance.

## QA guide refresh and rollback

`refresh_epg.py` reads the immutable catalogue and the exact approved mapping and source configuration in private R2 under `refresh-inputs/`. It only downloads feeds selected by the verified mappings, rejects synthetic or stale listings and keeps the active guide if a source fails or a mapped ID has no current or near-term programme. It writes the new XMLTV and compressed short guide objects under an immutable guide release. A conditional write changes only the guide reference in `current.json` once all objects have uploaded. Catalogue and D1 IDs stay on the same release. The script fails closed before exceeding its 2 GB QA refresh-storage budget.

The scheduled workflow is prepared on this branch. GitHub schedules only the workflow on the default branch. The QA environment also requires `LTV_XTREAM_QA_REFRESH_ENABLED=true`, `LTV_XTREAM_R2_ACCOUNT_ID` and the two bucket-scoped R2 credentials referenced in the workflow. No schedule or persistent publication credential is active. The initial deployment token expires on 30 November 2026 NZDT and is separate from scheduler access.

The initial QA catalogue and guide are both `v20261123-issue22`. To restore that baseline use an ETag-conditioned write of `{"release":"v20261123-issue22"}` to QA R2 `current.json`. For later refreshes the pointer records `previous_epg_release`; preserve the catalogue `release` when restoring the guide. The deployed Worker version and the protected production state are recorded in [the current state](../ops/CURRENT_STATE.md).
