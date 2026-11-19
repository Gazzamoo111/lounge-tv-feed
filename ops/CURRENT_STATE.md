# Lounge TV Playlist and EPG: Current State

Last metadata check: 2026-11-20 (NZ date).
Status: INITIAL INVENTORY ONLY. This document does NOT certify playlist playback, current domain routing, code parity or production readiness.

## Infrastructure
- GitHub: Gazzamoo111/lounge-tv-feed (public), default branch main.
- Supabase project: liqocisegeqzbyuqloql.
- Supabase list returned 71 Edge Functions. This is a count of installed functions, not evidence that all are in use.
- Deployment versions observed in Supabase list_edge_functions on 2026-11-20:
  - n: v37, ACTIVE.
  - lounge-core-xtream: v52, ACTIVE.
  - lounge-international-master-qa: v3, ACTIVE.
  - lounge-international-master-v4-qa: v15, ACTIVE.
  - lounge-international-epg-broker-qa: v8, ACTIVE.
  - lounge-core-epg: v1, ACTIVE.
- ACTIVE means the function is deployed; it does not confirm which public domain routes to it or whether it works end to end.

## Known source and automation
- GitHub README describes a legacy/October pipeline and cannot be trusted as current deployment documentation.
- .github/workflows/refresh-fast-epg.yml runs hourly at minute 7, rebuilds documents and may commit refreshed guide assets to main.
- The above GitHub workflow is not verified to be the source of the current Nuvio Xtream EPG. Map its consumers before changing it.
- Full correspondence between deployed Supabase Edge Function source and committed GitHub source is NOT YET VERIFIED.
- The NZ/AU customer-facing endpoint, International QA endpoint, domain aliases, paths, and credential model must be individually verified without committing private URLs or secrets.

## User-reported playback history, not a current pass
- On 2026-11-19 the user reported Sky Sport working and TVNZ 1/2 had previously worked with a corrected routing path.
- A later reported Xtream URL update was followed by TVNZ failure; the latest TVNZ playback result is unverified in this inventory.
- Do not treat either TVNZ or Fox/Kayo AU as passed until a current controlled test.
- Preserve working NZ/AU behaviour and customer credentials while investigating.
- Issue #4 and issue #6 contain historically useful QA and customer setup details but their old version references are superseded by current deployed function inventory.

## Current release designation
- Protected baseline: the serving NZ/AU customer configuration as verified through read-only inspection and device playback, NOT simply the highest-numbered function.
- International: QA-only until its source, domain routing, feature completeness and device playback pass the release checklist.
- Production change authorisation: not granted by creation of these documents.
- Last known-good deployable source snapshot: NOT YET CAPTURED.
- Last verified rollback artifact: NOT YET CAPTURED.
- EPG coverage baseline: NOT YET MEASURED.

## Required next audit
1. Resolve public endpoints/domain-to-function mapping and distinguish QA from customer traffic, without exposing secrets.
2. Export or reproduce current function sources in GitHub using secret-free configuration, with immutable release identifiers.
3. Capture protected NZ/AU metadata baseline: groups, order, icons, source choices, channel IDs, TVNZ and Sky routes, EPG IDs.
4. Audit EPG input, aggregation, refresh cadence and Nuvio guide selection.
5. Record a verified rollback procedure before the first production release.
6. Implement automated compare-and-regression checks, then validate on a Nuvio + IPTV device.
7. Update this snapshot after checks; never overwrite a problem with an untested success assertion.
