# Lounge TV Feed

Cloud-generated Lounge TV playlist, guide, and related feed assets.

## Catalogue status (verified 12 October 2026)

| Layer | Count | Meaning |
| --- | ---: | --- |
| Supabase `public.logical_channels` | 1,893 | Stable logical TV-channel identities (1,887 active) |
| Supabase `public.channel_sources` | 2,862 | Playback sources, including 1,893 primaries and 969 backups |
| BEST curated Android QA manifest | 7,737 | Approved numeric provider source IDs, **not** 7,737 live customer-facing channels |
| BEST full source register | 20,575 | Discovery/reference inventory, not a production playlist |

## BEST backend QA progress

**12 October 2026: private synchronisation and record-level tracking verified.**

- BEST Xtream credentials are held in Supabase Vault, **not** this public repository.
- 7,737 approved BEST source IDs exist in the private staging table:
  5,544 browsing candidates and 2,193 hidden/backup/reserve sources.
- The provider inventory is imported by BEST ID into private database tables:
  **20,575 live sources, 67,005 movie entries, 14,010 series entries
  (101,590 records total)**. These are not customer-visible counts.
- Scheduled background polling runs every four hours; results are checked
  every ten minutes; batch record imports run every minute.
- The record-level importer tracks added, changed, restored and
  twice-confirmed-missing source IDs without automatically deleting channels.
  A repeat live check processed all 20,575 records and identified **175 changed
  metadata records, zero added**; the audit trigger was corrected and retested.
- `public.lounge_best_qa_page_v2` supplies only approved live browsing candidates
  in metadata-only pages of up to 200, preserving curated labels separately
  from provider-renamed titles. The `best-catalogue-qa` Supabase Edge Function
  is on **version 2**, with JWT verification and Lounge owner/admin checks.
- 18 preliminary EPG-based identity matches have been queued for **manual**
  review; no customer favourites or old HaryTV channel identities were remapped.
- The BEST provider remains **paused**. Existing HaryTV playback mappings,
  EPG, public GitHub M3U feeds, Android/Fire TV packages and My Lounge are untouched.

**Production and QA are not yet switched together.** BEST metadata is
synchronised privately in Supabase, but it is **not live in the customer
feed**. Next steps: verify the exact installed QA runtime loader, use the
new versioned QA API safely, configure verified BEST playback-account
resolution, test channels/EPG/favourites, and then plan a controlled release.

## Android V4 QA source inspection

**12 October 2026:** Read-only inspection of the approved V4 Sport Categories,
V4 Additive Priority, and protected RowHeight QA source bundles confirms:

- The newer V4 Additive Priority project is an isolated QA build with
  package `com.loungetv.app.categoryfixedqa`, present on Fire TV and emulator.
- Existing `app.js` calls the native authenticated BEST M3U bridge and
  separately fetches the working HaryTV playlist; it preserves HaryTV fallback
  and only enters the BEST path after passing source-count checks.
- `LoungeUltimateQA.transform` filters the native BEST M3U against an
  **embedded** approved exact-ID map; it does not yet consult the private
  Supabase QA API.
- That embedded adapter contains 7,738 selected IDs, 5,545 visible:
  one additional explicitly approved channel (`1789688`) beyond the
  7,737/5,544 private backend manifest. This exception must be preserved.
- The private `best-catalogue-qa` endpoint requires an authenticated Lounge
  owner/admin session and is **not** callable from an unauthenticated Android
  device. Never embed a Supabase service-role key or management token in APK.
- Before wiring backend metadata into the app, inspect the existing
  `js/customer/customer.js` and native Android bridge authentication.
  Treat this as a scoped isolated QA change; **no production APK/feed changes**.

## Current feed pipeline

- `config/master_v5.json` controls the legacy GitHub catalogue selection.
- `scripts/update_feeds.py` generates `docs/lounge-clean.m3u` and
  `docs/epg6-live.xml` from upstream sources and that configuration.
- `.github/workflows/update-feeds.yml` runs every four hours.
- `docs/lounge-secure.m3u` is an older internal/backup representation,
  not the new BEST catalogue database.

This workflow does **not** automatically import newly approved BEST stream IDs
from the Android QA manifest into Supabase. Increasing a displayed count or
regenerating the existing playlist does not perform that migration.

## Required for the next production catalogue release

1. Review BEST-to-legacy channel identity suggestions; never cross-map numeric provider IDs.
2. Preserve customer favourites, stable `logical_channels.id`, and all existing HaryTV backups.
3. Verify the locked Android/Fire TV QA runtime loader and its current BEST session.
4. Keep hidden, event-reserve, adult and unverified sources out of normal browsing.
5. Validate BEST playback-ticket/proxy routing, EPG, startup, caching, and My Lounge in QA.
6. Release the new customer catalogue through an explicit tested cutover; do not overwrite legacy `docs/lounge-clean.m3u` blindly.

**Never commit IPTV provider credentials, authenticated URLs, service-role
keys or private tokens to this public repository.**
