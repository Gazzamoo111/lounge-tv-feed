# Lounge TV | Xtream from private M3U and XMLTV | QA

**Status:** CODE COMPLETE / UNIT TESTED / NOT DEPLOYED.

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

Create a private R2 bucket loungetv-xtream-private and a new D1 database loungetv-accounts. Update wrangler.jsonc with the new D1 ID before deploying QA. Use secrets AUTH_PEPPER, PROVIDER_AES_KEY_BASE64 and UPSTREAM_ORIGIN (must be HTTPS). Assign distinct provider credentials to each customer and encrypt them using the private provision_account.mjs tool. Never share the master M3U credential as a universal customer account.

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

Run node --test standalone-xtream/tests/worker.test.mjs; expected 11 PASS. Also run the private offline integration checks over the 14,717-stream generated dataset. Provision one QA account and test on an actual Nuvio device. No device test or customer signup was performed in the branch. The existing Supabase gateway is retained as the rollback path until account, playback, expiry, guide update, renewal and feature-parity gates pass.

See docs/MIGRATION_GATES.md. Deployment to Cloudflare requires account authorization not available in this chat.
