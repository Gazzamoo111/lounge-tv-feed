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

## QA guide transport optimisation (19 Nov 2026)

- The International QA XMLTV endpoint now streams only current programme records whose EPG IDs belong to the **selected customer-facing catalogue**; it does not download the entire active NZ/AU shared guide into memory.
- An authenticated XMLTV GET returned **HTTP 200**, well-formed XMLTV wrapper, **15,768,924 bytes**. Before the QA-only optimisation, the same gateway returned **90,774,577 bytes** of full shared guide data, a measured **82.6% payload reduction**.
- Optional HTTP gzip compression is implemented for requesting clients. Compressed output and actual Nuvio guide-sync time are **not tested**.
- Smaller guide size does not prove higher coverage: the earlier raw-ID snapshot measured **417/16,012**; the newer permanent-channel diagnostic is documented below. No synthetic or guessed EPG was imported.
- The bulky temporary HTTP responses from these checks have been deleted from the internal network-response table to avoid free-tier storage waste.

## International EPG source/matching audit (19 Nov 2026)

**Guide status: matching improved; programme ingestion and Nuvio EPG sync NOT complete.**

- Indexed 20 country XMLTV feeds from `iptv-epg.org`, storing **6,397 guide
  channel identities and upcoming-programme counts**, NOT programme titles
  or schedules. This is private QA metadata only. Commercial redistribution
  of third-party schedule data is **not yet authorised or verified**.
- `lounge_sync.international_epg_matches_qa_20261119` contains:
  **635** accepted exact provider-ID plus normalised channel-name matches;
  **410** accepted unambiguous same-country name matches with blank provider
  guide ID; and **391** conflicting populated provider IDs held for review.
  Total **1,045** QA-accepted source mappings, **391** held.
- BEST's original EPG ID can point to the wrong channel: e.g.
  `AR| FRANCE 24` points to `01TV.fr`, whose external display name is
  01TV. Never treat matching ID strings as valid without identity checks.
- Added authenticated `player_api.php?action=qa_epg_summary` to
  `lounge-international-master-v4-qa` (currently function v11), confirming
  **16,012 visible channel rows**. Excluding **4,110** themed 24/7 and
  event/PPV placeholder rows leaves **11,902 permanent candidates**.
  Of those, **583** currently have an effective EPG ID with live
  programme rows in the shared guide; a further **702** visible rows have
  newly accepted **metadata-only** EPG match candidates, while **259**
  visible conflicts require review.
- Note historical count **417/16,012** used the raw `epg_id` property
  without all gateway aliases and included an inappropriate denominator.
  The new permanent-channel diagnostic is more relevant, but even its
  583 matching IDs **do not independently prove correct programme titles**.
  The 702 candidate matches have not been delivered to the player.
- BEST's authenticated `xmltv.php` GET was confirmed to return XMLTV.
  The first 4 MB contained **9,348 channel tags and 8,182 programme tags**,
  proving it is not empty. Two attempts to fully index it via a Supabase
  Edge Function failed with **HTTP 546 WORKER_RESOURCE_LIMIT**;
  narrowing to selected channel IDs did not overcome this. The source
  ignores the HTTP Range header (`200`, no `Content-Range`).
  The complete BEST guide is **not imported**.
- Keeping whole programme schedules off Postgres is important:
  current total database size is approximately **489 MB**, near the
  Supabase free-tier database limit. Newly indexed EPG source metadata
  is approximately 1.5 MB.
- The QA guide route currently returns **only shared guide programmes**.
  External mappings are **not** silently inserted as invented listings.
  No NZ/AU v36 code or release state has been modified.

### Before release

1. Ingest current programme data from a permitted source without exceeding
   Supabase free-tier limits; avoid repeatedly loading the full BEST XMLTV
   into an Edge Function.
2. Validate exact EPG channel identities, time zones, refresh cadence and
   programme freshness per country. Review conflicts manually with evidence.
3. Serve validated EPG to a clean Nuvio + IPTV QA client and measure
   genuine visible programme coverage, sync latency and stability.
4. Confirm explicit commercial redistribution permission from each EPG
   provider before shipping the data to paying subscribers.
5. Exclude 24/7 and event/PPV placeholders from the 80% permanent-channel
   coverage denominator. **Current results do NOT meet 80%.**
