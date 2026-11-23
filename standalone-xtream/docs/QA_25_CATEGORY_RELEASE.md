# SUPERSEDED: DO NOT DEPLOY

The 25-category order described below was rejected by the owner. The approved order is **20 categories**, documented in [QA_APPROVED_20_CATEGORY_RELEASE.md](QA_APPROVED_20_CATEGORY_RELEASE.md). The corrected curation script and latest private QA package supersede this historical design. This document is retained only as a record of the rejected candidate.

---

# Lounge TV | Issue #23 | 25-category QA presentation change

**Status:** Code committed and offline private seed validated. **Not yet uploaded to live QA R2**. Existing production and Supabase must remain untouched.

## Why this change
Owner physical Nuvio screenshots 23 November 2026 show unwanted `##### GENERAL`, `####### 9NOW RAW`, `######## 9NOW RAW`, and `INFO` pseudo-channels, plus undesirable source-based category order and 37 groups.

The approved 14,717-entry private M3U contained 37 source categories. The initial QA compiler passed them straight through, with the original order starting in 4K Relax.

## New visible order
1. 🇳🇿 NZ Sky Sport
2. 🇦🇺 Australian TV
3. 🇦🇺 Australian Sport
4. 🇬🇧 UK TV
5. 🇺🇸 US Networks
6. 🇺🇸 US Regional TV
7. 🌍 International Sport
8. 🎬 Movie Channels
9. 🎟️ Movie Streams
10. ⭐ Entertainment and Comedy
11. 🧸 Kids and Family
12. 🔎 Documentaries and Lifestyle
13. 📰 News
14. 📺 Streaming Services
15. 📡 FAST TV
16. 🎵 Music
17. 💎 4K UHD
18. 🍿 24/7 Movies
19. 📺 24/7 Series and Classics
20. 🎭 24/7 Drama, Crime and Action
21. 😄 24/7 Comedy
22. 🧩 24/7 Kids and Cartoons
23. 🎁 24/7 Variety
24. ⏪ Sports Replays
25. 🏆 Live Sports and PPV

Streaming source labels `PRIME|` and `TV|` are assigned to FAST TV; other source Streaming entries stay in Streaming Services. Every remaining category is mapped explicitly from the original 37 IDs. Within each merged category, the original stream order is preserved.

## Strict invariants from local rebuild
- Source inventory: **14,717** unique numeric stream IDs.
- Visible Xtream catalogue and M3U: **14,369** streams across **25** categories.
- **348** decorative `##...` banners and explicit `INFO` placeholders, all with **zero EPG IDs**, excluded from visible APIs but retained in private `catalog/hidden_info.json` and the unchanged original private M3U/SQL seed.
- Every one of the original 14,717 stream IDs remains in unchanged D1 `stream_ids_seed.sql`; no source ID or playback entitlement deleted.
- All non-placeholder stream URLs, logos, `tvg-id`, and stream IDs unchanged. Only the displayed category ID/name and channel `num` sorting changed.
- The complete gzip XMLTV and all original short-EPG objects are byte-for-byte unchanged.
- 13 offline invariants passed, including checking every file against the newly generated SHA-256 manifest. Python categorisation regression tests pass on GitHub.
- Private QA R2 ZIP `LoungeTV_QA_25_Categories_Private_20261123.zip` SHA-256 `632912da17e3356c5699c202726e94988f893f0cb18c6e02a5d30f66bce0555e`, 30,221,419 bytes. Delivered only via private ChatGPT conversation, **never in public GitHub**.

## Deployment steps for authorised Work session
1. Verify this ZIP SHA and manifest and compare with live `loungetv-xtream-private` `current.json`; preserve its present object/version and download a rollback backup. Existing active baseline is documented as `v20261123-issue22`. Do not overwrite that immutable version.
2. Upload all **seed/catalog/** and **seed/epg/** objects from ZIP under a NEW immutable R2 release prefix such as `releases/v20261123-categories25/`, retaining the existing files, then verify a complete private upload and metadata parity. The new `stream_ids_seed.sql` is deliberately unchanged, so no D1 schema or entitlement mutation is needed.
3. Update the QA R2 release pointer `current.json` using ETag-conditioned write only after validation; preserve any active independent `epg_release` pointer, not revert to stale XMLTV. Current Worker supports split EPG release pointer.
4. Use the private QA credentials to verify `get_live_categories` returns **25 in intended order**, `get_live_streams` returns **14,369** visible entries, no `INFO` or `##` pseudo-channels, stream IDs unique, M3U export matches, XMLTV unchanged and `get_short_epg` works.
5. Refresh only the QA connection on Nuvio, verify group order and no decorative banners. If the player caches category IDs, remove/re-add only the QA playlist, not production.
6. On failure, restore exact prior `current.json` with a conditional write. Keep the old immutable release. Do not delete or modify `connect.loungetv.nz`, Supabase or active customer logins.

**Separate release blocker:** The approved private Stage 12.1 master contains **NZ Sky Sport entries but no dedicated general NZ Live TV group**. New Zealand broadcast channels such as TVNZ 1 and TVNZ 2 must be sourced and verified separately before production migration. A category rename cannot create missing streams.

**Playback:** This is a presentation-only change and does not fix the pending BEST HTTP origin playback issue or assert device acceptance.
