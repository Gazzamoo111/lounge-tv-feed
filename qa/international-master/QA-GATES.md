# Lounge TV International Master: QA Build Status

**As of 19 November 2026: implemented in isolated QA, NOT ready for customer release.**
**Production `n` v36 and original `lounge-international-master-qa` v3 are untouched.**

## Implemented and verified

- BEST International Master trial authenticated against the provider; returned all
  **835** live category banks via `get_live_categories`.
- Fixed HTTP 451 block on bulk inventory polling by category-scoped
  `get_live_streams&category_id=<id>` queries using a bounded,
  single-use-authenticated QA Supabase Edge importer.
- Imported **54,971 unique provider live IDs from 835/835 banks** into
  `lounge_sync.international_master_streams_qa_20261119`.
  Two HTTP 503 categories succeeded on retry.
- Preserved category metadata in
  `lounge_sync.international_master_categories_qa_20261119`.
- Generated a **16,910-source precomputed, balanced QA selection** using
  `lounge_sync.international_master_selection_qa_20261119`. It removes radio,
  adult and placeholder banks, prioritises observed video and existing guide
  evidence, balances region/country coverage and keeps event overflow separate.
  **This is selection, not playback proof.**
- The QA-only `lounge-international-master-v4-qa` Edge Function serves this
  shortlist with unchanged NZ/AU curated bindings and TVNZ Widevine M3U
  metadata. The old Asian add-on overlay has been removed.
- An authenticated `player_api.php?action=qa_summary` returned **16,012
  customer-facing live entries across 95 populated categories**.
- An authenticated `get.php?type=m3u_plus` returned HTTP **200**, a
  **5,157,734-byte M3U** with **16,012 EXTINF channel entries**. Its
  category numbering is contiguous from **01 to 95**. TVNZ 1/2 and
  DRM metadata are present. Live Events and PPV Source Overflow are last.
- Category-contract GitHub Actions tests passed prior to integration; changes
  remain in draft pull request #9, not merged to the main branch.

## Confirmed outstanding gates

1. **EPG:** only **417 of 16,012** selected channel entries currently
   have a guide with actual programmes through the shared guide table.
   EPG IDs alone do not count. BEST provider `get_short_epg` returned zero
   programmes for three sample IDs; `xmltv.php` HEAD returned HTTP 200
   with an empty text/html response. Independent EPG sources require
   exact ID matching, programme validation and commercial rights review.
   Do not promise 80% EPG coverage.
2. **Playback:** HTTP playlist generation and TVNZ DRM tags are confirmed;
   long-duration channel playback and Nuvio + IPTV device behaviour have
   not been verified. Test live streams on a real player and investigate
   affected regional banks before promoting sources.
3. **Delivery:** The BEST account is a short trial with provider-reported
   expiration **2026-11-19 21:24:19 UTC** (20 Nov at 10:24 NZDT).
   Future customer credentials must carry the correct entitlement for this
   International Master template.
4. **Performance:** 55k records loaded into the function directly caused
   Supabase HTTP 546 WORKER_RESOURCE_LIMIT; a precomputed shortlist resolved
   it. The 16k-entry 5.16 MB M3U still requires clean Nuvio sync timing,
   memory, guide loading and stability tests.
5. **Source reliability and commercial permission:** The importer retrieves
   provider entries, not licensed or continuously verified channels.
   Confirm rebroadcast and EPG redistribution rights before selling.

## Safety boundaries

- No edits or deployments to `n` v36, original International QA v3 or
  active production catalogue tables.
- No paid Supabase branch, extra project or recurring polling job.
- All importer requests are rate-bounded and require single-use tokens;
  trial credentials are loaded server-side from Supabase Vault.
- Trial credentials and stream URLs are not committed to GitHub.
- Never merge this PR or route customer devices to v4 QA until every
  release gate above is met.
