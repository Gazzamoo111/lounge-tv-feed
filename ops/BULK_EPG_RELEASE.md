# Bulk Lounge TV programme guide

The candidate is in [feed PR #15](https://github.com/Gazzamoo111/lounge-tv-feed/pull/15) and [player PR #80](https://github.com/Gazzamoo111/lounge-tv-player/pull/80). Track approval and promotion in [Issue #10](https://github.com/Gazzamoo111/lounge-tv-feed/issues/10).

## Evidence from 20 November 2026

The authenticated M3U routes provided 13,375 NZ/AU rows, 13,379 Plus rows and 16,012 International Regional v4 rows. Offline projections matched the captured stable IDs and ordering. The shared working reference is the complete canonical player artifact at `76a85f22babacc16656b0bdb0a9eb32f94ad62a2`. The International reference came from the authenticated Regional v4 XMLTV response with `X-Lounge-Guide-Scope: compiled-private-qa`.

| Profile | Eligible | Mapped before → after | Current before → after | Next before → after | Both before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| NZ/AU | 4,255 | 686 → 1,002 | 605 → 938 | 605 → 938 | 605 → 938 |
| Plus | 4,259 | 690 → 1,006 | 609 → 942 | 609 → 942 | 609 → 942 |
| International | 11,784 | 3,936 → 4,935 | 2,890 → 4,023 | 2,934 → 4,050 | 2,883 → 4,017 |

The shared candidate contains 1,572 XMLTV IDs, 101,268 programmes and 323 new or extended per-ID short files. The compiled International candidate contains 5,170 XMLTV IDs and 254,247 programmes. The public source health summary can record statuses and contributions. Keep authenticated playlist exports, the compiled guide and per-channel evidence private.

The bulk generator ran against 108 endpoints. Eighty-four parsed with forward data and 57 contributed. The run processed 217,312,625 input bytes in 101.2 seconds locally. The fallback for each new schedule checks identity, market, country and valid programme windows. The four reviewed Australian identifiers came from IPTV-EPG. The shared candidate also retained existing safe schedules and the seven PR #15 EPG alias corrections. The same builder run offline with authenticated M3U alone gained 298 rows in NZ/AU, 298 in Plus and 1,132 in International for both listings.

The International baseline had 2,299 duplicate channel declarations, as well as conflicting programme windows. Two Arena Sport 5 Croatia rows and one Antena Stars row retained current coverage and lost a next listing that previously overlapped the existing programme. These exceptions are identified in the private candidate evidence. TVNZ and Sky Sport routing, Plus delegation and catalogue order passed protected offline replay. The broker's version check and renderer's gzip/fallback paths passed local mocked checks. Device playback and the deployed candidate path have no acceptance evidence yet.

## Promote after approval

1. Review the exact PR heads and approve the publish scope in Issue #10. Integrate player #80 with `LOUNGE_EPG_BULK_MODE` unset to leave the aggregate publisher inactive. Review source redistribution permissions before publishing new external programme metadata.
2. Use the existing authorised release path for the International QA broker based on v8, with `LOUNGE_BULK_EPG_WRITE` disabled. Its updated OIDC check accepts only the existing legacy workflow or the specific player main-branch workflow and its prescribed endpoints. Bind the two dedicated QA M3U URLs as `LOUNGE_EPG_NZ_AU_QA_M3U` and `LOUNGE_EPG_PLUS_QA_M3U` repository secrets. Set `LOUNGE_EPG_BULK_MODE=candidate` and manually run the existing AU/EPG workflow. Review the live-input candidate totals and freshness while the publisher is disabled.
3. For the shared guide, publish the validated candidate at `epg-data:epg/bulk/guide.xml.gz`, its manifest at `epg-data:epg/bulk/manifest.json`, and the per-ID JSON at `epg-data:epg/bulk/short/`. The job compares the captured branch head with the current head before its non-forced push. The existing canonical guide files and database export remain separate so newly attached programmes cannot change catalogue ordering.
4. For International, enable `LOUNGE_BULK_EPG_WRITE=1` only for the approved upload window or recurring publishing. The broker accepts a bulk PUT against the version captured at build time and disables legacy PUTs while the setting is active. It updates only the existing private bucket object `lounge-international-epg-qa/international-master.xml.gz`. The current International gateway already serves that object. After approval for both publishing steps, use `LOUNGE_EPG_BULK_MODE=publish` to refresh both validated destinations twice a day. The two destinations have independent checks and can succeed independently.
5. For shared delivery, integrate the approved `n` v37 and `lounge-plus-qa` v5 candidates from feed #15 and the `lounge-core-live-xmltv` v24 candidate from `qa/shared-epg/edge/` in player #80. Enable `LOUNGE_BULK_EPG_ENABLED=1` after the shared files exist and check authenticated guide scope, source health, short-guide retrieval and protected playback under the approved acceptance scope.

A failed upstream feed is isolated. The generator keeps valid retained programmes, compares exact inputs before promoting and preserves the previous published data if the job fails. The renderer uses the stock guide if the bulk manifest or artifact is unavailable. It considers a bulk manifest stale after 48 hours.

## Rollback

Set `LOUNGE_EPG_BULK_MODE=candidate` to pause promotion. Disable `LOUNGE_BULK_EPG_ENABLED` to return the shared renderer and short guide to their existing paths. The canonical branch revision remains `76a85f22babacc16656b0bdb0a9eb32f94ad62a2` as the measured baseline. Restore the previous private International artifact through the approved version-checked writer if that object was promoted. The packaged rollback gzip has SHA-256 `20a44d3972438b21fc188db1d055bea8cfe881983dfe7bde647145b1c0ad26fa`. Disable `LOUNGE_BULK_EPG_WRITE` after rollback if the legacy writer is to resume. The existing Phase 1 recovery procedure covers the original v37, v5, v24 and v8 bundles.
