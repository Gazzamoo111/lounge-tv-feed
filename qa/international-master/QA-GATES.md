# Lounge TV International Master: QA v4

**Status: INCOMPLETE / DO NOT ROLL OUT.** This branch and the separate
`lounge-international-master-v4-qa` Edge Function are QA-only.
Production `n` v36, the production releases and the original
`lounge-international-master-qa` v3 are not changed.

## Source of truth and what exists

- QA gateway: `lounge-international-master-v4-qa`, isolated Edge Function.
- Full new BEST International Master category taxonomy: **835** categories
  from an authenticated `get_live_categories` trial call, stored in
  `lounge_sync.international_master_categories_qa_20261119`.
- The full worldwide **stream list is not imported**. The QA gateway currently
  combines the existing Nov 9 BEST snapshot (16,140 marked-present live records),
  the currently published curated NZ/AU channels and selected existing SEA
  stream candidates. Those are not a reliable inventory of all 835 trial groups.
- Existing SEA QA table has 2,982 stream records, 2,714 choice_rank=1. Selection
  is not the same as verified playback.
- Shared guide table has 1,194 channels with nonexpired programmes as audited.
  The 80% threshold has not been achieved or demonstrated.

## Presentation contract

- Flat Xtream groups. The architecture owns one priority order and emits
  **only nonempty groups** with consecutive visible display numbers.
- Country grouping uses proven provider category prefixes, and explicitly
  handles collisions such as `AR` (Arabic, not Argentina), `IR` (Iran versus
  Ireland), `CH` (China versus Switzerland), `SK` (South Korea).
- Category display numbers in M3U and Xtream are derived from the same
  `nuvioVisibleLabels()` function. Category IDs are stable within this QA
  implementation. Existing production IDs are not changed.
- Never invent an absent territory's channels or EPG; unknown source groups
  remain International TV.
- Live Events and PPV Source Overflow remain at the bottom.

## Existing media behaviour retained

- NZ/AU curated release remains the foundation.
- TVNZ DRM-aware M3U export uses existing `nzPlaylistLines()` handling.
- Sky Sport FHD selection, AU duplicate controls and existing EPG aliases
  remain implemented in the QA function.
- `get_live_streams` intentionally responds with the existing 503 M3U retry
  directive to preserve TVNZ Widevine playback in Nuvio; this should be tested
  end to end, not treated as a failure until client fallback is observed.
- No stream playback was verified from a real Nuvio client during this build.

## Acceptance gates (not yet passed)

1. Import a current, authorized **full stream list** for the test account.
   Validate the source item ID and category ID join against the 835 categories;
   do not treat category metadata as stream coverage. Do not write to the
   shared `best_inventory_items` production snapshot.
2. Filter rejected, placeholder, duplicate and dead streams. Prefer stable
   working FHD sources over misleading HD/4K names. Preserve verified backups.
   Record a playback probe result and date for every primary source.
3. Verify M3U sync and flat category order on Nuvio + IPTV; test NZ TVNZ 1/2,
   Sky Sport, AU Fox/Kayo, UK, US and a representative channel per new region.
4. Quantify valid logos and EPG programmes by permanent channel group,
   separating true guide matches from an EPG ID string with no current shows.
   Aim for 80% of permanent channels; exclude PPV/overflow from that denominator.
5. Validate login with an active customer trial without displaying credentials
   in logs or reports; check expiration and entitlement behaviour.
6. Measure total playlist duration, category/channel count, M3U size, cache
   and sync performance with a clean Nuvio + IPTV install.
7. Review provider rebroadcast/commercial rights and all DRM handling before
   selling the additional channel coverage.
8. Publish only after a signed-off QA result. No automatic production promotion.

## Operational constraints

- Free tier only, no new Supabase project or paid branch.
- QA category snapshot occupies approximately 152 KB as measured at import.
- No cron or recurring provider polling was added.
- A new worldwide full stream snapshot should use a bounded, rate-limited
  and isolated storage strategy rather than duplicating the active inventory.
