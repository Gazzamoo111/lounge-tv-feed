# Cloudflare On Demand migration

Target [tv.loungetv.nz](https://tv.loungetv.nz) and [Issue #29](https://github.com/Gazzamoo111/lounge-tv-feed/issues/29). The existing Cloudflare Worker authenticates the same Lounge TV account in D1 before each VOD read and media redirect. BEST authorises playback against the customer's assigned line. Supplier credentials are excluded from Xtream catalogue responses, M3U entries and GitHub. Redirects follow the existing assigned-line playback model, so the requesting player receives that line's media URL.

## Bootstrap and verification

1. Export the existing approved release once with `psql -X -At -v ON_ERROR_STOP=1 -f standalone-xtream/vod/export-approved.sql` using a private read-only connection. Save stdout to a protected local file. Use the current active editorial release as the export source. The 24 November NZDT query verified 5,142 movies, 1,641 series and 48,369 unique mapped episodes. Do not commit or log the snapshot.
2. Stage the extracted snapshot in Standard private R2 under `vod/approved.json`. Run the GitHub workflow's `validate` mode first. Use `bootstrap` to publish immutable catalogue objects and the separate `vod/current.json` pointer. This leaves live/EPG's `current.json` and account data alone.
3. Build a candidate from the production Worker config using the same bindings. Set `ENABLE_VOD` to `true` for the authenticated candidate. Test existing login, six VOD actions, movie and episode startup and seeking, Plus/NZ paths as applicable, Sky Sport, TVNZ 1/2 and XMLTV.
4. Test Nuvio on the actual Fire TV build. If it omits Xtream VOD after falling back to `get.php`, test `ENABLE_VOD_M3U=true` on the candidate. It appends movie and episode paths behind the original live template, including its unchanged DRM tags and EPG URL. Verify classifying entries under On Demand, avoiding duplicates, import time and memory on the actual device before enabling this variant. The combined playlist can include 48,369 episodes.
5. Promote the candidate only after those checks. Existing feature flags default to disabled. Roll back either by restoring Worker version `8a90126d-709e-4f18-bd6c-1b631ac05bc4` or by moving only `vod/current.json` to its last known good version with the current ETag. Keep live and EPG pointers as found.

## Maintenance

The workflow uses the existing production R2 environment. Configure an authorised VOD inventory line through `LTV_VOD_SUPPLIER_ORIGIN` (HTTPS), `LTV_VOD_SUPPLIER_USERNAME` and `LTV_VOD_SUPPLIER_PASSWORD`. Verify that the runner can read both supplier catalogues before enabling the existing scheduled workflow through repository variable `LTV_VOD_AUTOMATION=enabled`. A failed or suspiciously incomplete supplier response keeps the last release active.

Refresh can hide unavailable approved titles and restore them on reappearance using the original ID. It recomputes featured rows from the approved snapshot. Admission and mapping of newly supplied titles and episodes need a follow-up, including metadata matching and explicit supplier availability checks. Snapshot data remains in private R2. VOD storage is capped at 250 MiB, with the existing account's aggregate free-tier consumption to be checked before rollout. A publish beyond that cap stops with the current pointer intact.
