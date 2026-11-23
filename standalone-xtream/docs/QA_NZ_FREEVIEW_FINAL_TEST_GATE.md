# Issue #23 | NZ Freeview + premium 25-category QA release gate

**Status: PRIVATE QA ARTEFACT READY. CODE TESTS GREEN. NOT DEPLOYED. NOT ACCEPTED ON NUVIO.**

## Background
- The original verified BEST master contains 14,717 numeric stream IDs, but only 23 NZ Sky Sport items and **no ordinary TVNZ 1/2/Three/Māori/Te Reo live channels**.
- The legacy production `production/n/nz-routing.mjs` already uses MJH NZ Freeview overrides on IDs `900000001..900000005` for TVNZ 1, TVNZ 2, Three, Whakaata Māori, and Te Reo. TVNZ 1/2 are MPEG-DASH and Widevine; other three are HLS. The existing Supabase `tvnz-license-qa` function was a constrained POST challenge relay; do **not** keep its Supabase dependency in this standalone Worker.
- Official MJH source [issue #290](https://github.com/matthuisman/i.mjh.nz/issues/290) states TVNZ stopped offering clear HLS streams in June 2026; Android IPTV players need Widevine and `#KODIPROP` support.
- Previous NZ production gateway deliberately made compatible Nuvio retry `get.php` when native Xtream responses could not carry DRM metadata. This is implemented as **QA-only** `NUVIO_M3U_DRM_FALLBACK=true`, not a production change.

## Implemented on draft PR #24
1. `src/nz-live.mjs` gives only five fixed known public NZ sources. No BEST credentials or customer tokens are stored in it. Stream IDs are from existing working production configuration.
2. `src/worker.mjs` routes only these five D1-approved NZ IDs to MJH NZ, never rewrites them as BEST IDs. Ordinary streams continue their approved provider redirect behaviour. TVNZ's authenticated licence route forwards unchanged Widevine challenges to the approved upstream, accepts only the expected signed redirect target and propagates denials. It never decrypts or invents keys. Relays are QA-flag-gated and time-limited.
3. Existing `/get.php` expands Xtream credentials in the private M3U template. TVNZ 1/2 entries carry their original `#KODIPROP` metadata with the standalone QA licence URL; the Nuvio M3U compatibility fallback is QA-only. Native Xtream JSON carries the same QA-account-specific licence URL for clients which support it.
4. CI tests cover redirects, licence account authentication, upstream refusals, unsafe redirect rejection, disabled flags, unknown IDs, M3U fallback and unchanged original BEST account authentication.

## Private curated seed and integrity
**Private filename:** `LoungeTV_QA_Premium25_NZ_Freeview_PREVIEW_20261123.zip`
**SHA-256:** `12cf4bfc4ec7cf2b89bf8e3613f550a2dbac9ec66112aeb5d98c3a278b70dd63`
**Size:** 30,139,419 bytes.
**Source:** `LoungeTV_QA_Premium25_ChannelOrder_PREVIEW_20261123.zip`.

- The 25 category names/IDs/order are unchanged.
- 13,297 visible entries (13,292 + five NZ Freeview). New Zealand now has **28** visible entries.
- NZ order: TVNZ 1; TVNZ 2; Three; Whakaata Māori; Te Reo; followed by the original 23 Sky Sport/ESPN entries in their approved internal sequence.
- All original approved 14,717 IDs remain in the preserved source/D1 seed (13,292 visible from the curated seed plus 1,425 recoverably hidden). Five new NZ IDs are unique and specified in `seed/nz_freeview_d1_additions.sql`.
- **Live Events/PPV**: all 6,756 original entries and `catalog/by-category/25.json` byte-for-byte unchanged. All 6,756 rows in `live_all.json` still have exactly identical object contents and order, including their `num` values.
- Existing XMLTV gzip, all short EPG objects, original D1 SQL seed, categories and non-NZ channel rows are byte-identical to the prior private preview. New TVNZ/Three/Māori/Te Reo EPG IDs are intentionally empty until **genuine current/upcoming schedules** are sourced and mapped. Do not invent listings or claim these five are covered.
- The M3U includes DRM playback properties for TVNZ 1/2 and uses a stable NZ `/live` link for each new row. There are no private provider credentials in the catalogue ZIP.
- Full private SHA256 manifest, 13,297 unique IDs, unchanged PPV, unchanged source, 25 category count and 2 TVNZ licence lines have all been validated locally.

## Release instructions for authorised Cloudflare Work session ONLY
- Scope to Worker `loungetv-xtream-standalone-qa`, D1 `loungetv-accounts`, and private R2 `loungetv-xtream-private`. No production routes, accounts or Supabase edits.
- Before changing anything: record live QA Worker deployment version, current R2 `current.json` complete content + ETag, D1 state and `v20261123-issue22` immutable rollback baseline.
- Deploy source from PR #24 QA branch and verify all flags in QA Wrangler only: `ALLOW_HTTP_UPSTREAM=true`, `ENABLE_NZ_OVERRIDES=true`, `ENABLE_TVNZ_LICENSE_RELAY=true`, `NUVIO_M3U_DRM_FALLBACK=true`. The existing BEST `UPSTREAM_ORIGIN` must be set to the **previously verified exact HTTP origin** and the QA account must have corresponding encrypted BEST credentials and matching bouquet. **Never invent or leak an upstream hostname or provider line.**
- Apply only `seed/nz_freeview_d1_additions.sql` as idempotent `INSERT OR IGNORE` in QA D1 to whitelist five new IDs; never apply `stream_ids_seed.sql` to production or wipe QA entitlements.
- Upload the private ZIP's `seed/catalog/` and `seed/epg/` files under a NEW immutable release prefix in the existing private QA R2 bucket, e.g. `releases/v20261123-premium25-nz5/`. Validate all expected objects/hashes before any pointer change.
- Activate only with an **ETag-conditioned** change of the QA R2 current pointer, preserving any independent `epg_release` and `previous_epg_release` references. **Do not use old `upload_release.py --activate`**, which overwrites the pointer without preserving the independent guide reference.
- Validate the QA login, `get_live_categories`=25, M3U=13,297 entries, New Zealand first five as listed, complete XMLTV and PPV 6,756 unmodified. `get_live_streams` returns **503 deliberately** while Nuvio's M3U-DRM fallback is enabled, so validate this behaviour and ensure Nuvio actually retries `get.php`.
- With a physical Nuvio + IPTV device, accept **TVNZ 1 and 2** Widevine playback and sustained video/audio, Three, Whakaata Māori, Te Reo, Sky Sport NZ 1 for 10+ minutes, plus representative AU, UK, US and PPV listings. Respect DRM upstream refusal. No browser/API-only test substitutes for that playback test.
- Finally update the unified XMLTV with genuinely matched current/upcoming TVNZ schedules, verify EPG alignment, and activate safe automatic EPG refresh separately. Do not publish a flat 72.88% claim for newly added NZ channels.
- If any route, playback or guide mismatch occurs, restore the exact prior QA pointer using a conditional update, revert the prior QA Worker version, leave the extra D1 IDs inert (do not remove original rows). Production is never changed.

## Unverified and blocking
- **The offline runner could not resolve the live MJH NZ host. No live HTTPS manifest, licence grant or physical Nuvio playback is verified from this chat.**
- Licence service can refuse authorisation or playlist redistribution. No substitute key, bypass or unapproved source is allowed.
- The five NZ channels have no verified schedules in the current compiled XMLTV.
- Existing Cloudflare QA is still serving the previous 37-category release until separately deployed and Nuvio refreshed.
- No production or Supabase deletion/cutover authorised.
