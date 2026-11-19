# Lounge TV Playlist and EPG current state

Audit date 20 November 2026 NZDT. Tracking [Issue #10](https://github.com/Gazzamoo111/lounge-tv-feed/issues/10). Supabase project `liqocisegeqzbyuqloql` reported healthy with 71 installed Edge Functions. This audit covers the 15 bundles in the [release manifest](phase-1/release-manifest.json).

Phase 1 established a recoverable source baseline and the routes below. Phase 2 offline checks can begin. A release gate still needs authenticated feed exports, measured playback and guide baselines, and a rollback rehearsal against an isolated environment.

## Serving paths

| Path | Function | Evidence and behaviour |
| --- | --- | --- |
| `n.loungetv.nz` | `n` v37 | Public `player_api.php` returned the expected unauthenticated Xtream response. The pinned Worker forwards the root and Xtream suffixes. Origin logs record 166 v37 calls with this alias hint. |
| Plus Live TV on `n.loungetv.nz` | `n` v37 → `lounge-plus-qa` v5 | A Vault-backed account match delegates the Xtream login, Live TV and guide routes. VOD uses the normal handler. Origin logs record v5 traffic with the same alias hint. |
| `connect.loungetv.nz` | `lounge-core-xtream` v52 | Public `player_api.php` returned the expected unauthenticated Xtream response. The Worker configuration and alias-marked v52 origin requests agree. Authenticated use was not verified. |
| `connect.loungetv.nz/n` | Historical Worker in GitHub | The live `player_api.php` probe returned `not_found`. Do not use this path as the protected NZ/AU alias. |
| International regional QA, direct Supabase function | `lounge-international-regional-qa` v4 | Exact match to the International branch tip source. Logs show 7 M3U and 5 XMLTV HTTP 200s, plus 93 live redirects. This is the best-supported Phase 2 QA target. |
| International parallel master QA, direct Supabase functions | `lounge-international-master-v4-qa` v15 and `lounge-international-master-qa` v3 | Both saw recent requests. The v15 master handled 17 M3U and 27 XMLTV HTTP 200s, plus 74 live redirects. Keep both paths intact. No unique International customer-facing alias or current in-app selection was confirmed. |
| Revocable customer M3U QA, direct Supabase function | `lounge-customer-playlist-qa` v2 → `n` v37 and `tvnz-license-qa` v1 | Separate token-based path resolved through service assignment and private account material. Customer adoption and device acceptance were not measured in this audit. |

Evidence combines deployed source, pinned Worker configuration, credential-free public probes and aggregate Supabase Edge logs from the 24 hours ending 20 November 2026 at 08:15 NZDT. Worker dashboard deployment IDs were unavailable. HTTP success and redirects are transport evidence. The logged requests do not establish that a device played or received a usable guide.

## Protected NZ/AU behaviour

- Standard `n` accounts authenticate using their individual BEST service. The authenticated `get_live_streams` action deliberately returns 503 with `nuvio_m3u_drm_fallback_required`. Preserve the existing `get.php` path that emits the DRM-aware M3U for compatible TVNZ playback. A direct DRM-required live request can return 422 by design. The v37 logs contained 2 Xtream 503s and 10 Live TV 422s. The audit did not inspect those response bodies or attribute them to individual channels.
- Preserve the deployed NZ/AU category order, regional grouping, icons, channel IDs, Sky routing and fallback priority. Their source is captured. The current device-visible counts, logo/guide IDs and provider-facing outcomes still need an authenticated baseline.
- The active delivery catalogue was `ppv-curated-817-20261106-qa`. Its persisted live rows numbered 3,231, with 565 non-empty stored EPG IDs and a manifest expectation of 3,003 rows. Xtream and M3U add filters, aliases and dynamic provider rows. Use these figures as database context only.

## Guide chains

- Standard NZ/AU `n/xmltv.php` authenticates the viewer, requests `lounge-core-live-xmltv` v24, and falls back to BEST XMLTV on a failed guide response. The renderer reads `Gazzamoo111/lounge-tv-player` branch `epg-data` at `epg/guide.xml`, with Sky and UK supplement logic and a core fallback. The short EPG path has separate shared-database, sibling-repository short-guide and provider fallback logic.
- Supabase cron invokes `lounge-shared-epg-sync` v3 every five minutes. The function imports the player repo's `epg-data` shards into `lounge_delivery.shared_epg_channels`. The DB held 1,194 rows and 1,184 with positive programme counts and unexpired data, last synced at 08:00 NZDT. This is shared-store freshness rather than Nuvio coverage.
- The International branch workflow uses GitHub OIDC to call `lounge-international-epg-broker-qa` v8. The broker uses the dedicated QA access held in Vault for BEST and master/regional QA requests and accepts a compiled guide upload into a private Supabase bucket. Master v15 and Regional v4 prefer the compiled artifact, then fall back to eligible, unexpired shared EPG rows. Ingest QA v14 gathers provider and guide evidence in QA tables. The private object existed and was last updated on 19 November at 21:14 NZDT (9,130,487 bytes). The logs do not identify which guide branch supplied each XMLTV response. In-app guide selection remains unverified.
- The feed repo's `refresh-fast-epg.yml` still builds and commits `docs/epg6-live.xml` and fast guide JSON artifacts on its hourly schedule. A successful scheduled run was recorded on 20 November at 01:50 NZDT. No direct dependency on those assets was found in the audited NZ/AU and International XMLTV chains. Preserve the workflow while its other consumers are investigated.

## Source and rollback

- The manifest pins 76 source files by exact Git blob and SHA-256 across branch tips, with 9 unmatched files in the private archive named there. The versions, deployment timestamps, JWT/import-map settings and Supabase package hashes were captured. A local rebuild restored all 85 files byte for byte and checked relative imports.
- `n` v37 is the protected source restore point. Its 14 files are all available from pinned GitHub revisions. The v36 rollback entrypoint in the Plus routing branch is historical and would remove the account-scoped Plus route. Whole-service rollback remains unrehearsed. See [recovery steps](phase-1/RECOVERY.md).
- No runtime deployment, domain change, guide upload, scheduled job edit or customer change was performed in this audit. No current TVNZ, Sky Sport, Fox/Kayo, International or Nuvio device playback result was verified. See [#4](https://github.com/Gazzamoo111/lounge-tv-feed/issues/4), [#5](https://github.com/Gazzamoo111/lounge-tv-feed/issues/5) and [#6](https://github.com/Gazzamoo111/lounge-tv-feed/issues/6) for historical context.

## Phase 2 offline QA

Phase 2 branches from the Phase 1 source record. A fresh Supabase metadata read matched all 15 recorded bundle versions and hashes. The [offline suite and capture instructions](phase-2/REGRESSION.md) cover NZ/AU v37, Plus v5 and International Regional v4. Local checks passed 34 existing Node tests, 11 validator tests and all three synthetic gateway profiles. The suite exercises the intentional Xtream 503 and direct TVNZ DRM 422. CI runs the same contracts on proposals.

The release gate is closed. Authenticated QA feed snapshots, actual Nuvio playlist/guide import and playback, and isolated rollback are still unverified. The `n` v37 source bundle remains the protected restore reference. See [Issue #10](https://github.com/Gazzamoo111/lounge-tv-feed/issues/10) for the current review and CI record.

## Phase 3 release controls

The [release process](phase-3/RELEASE.md) and [history](phase-3/HISTORY.md) are reviewable on the Phase 3 branch. This read-only recheck matched all 15 observed Edge Function versions and package hashes, plus all 45 deployed source file digests for the three protected gateway bundles. The two target manifests pin the source, routes, function settings, audited dependencies and rollback reference. The local rehearsal restored selected bundles byte for byte and reproduced the synthetic responses while preserving the peer target.

The release gate remains closed for promotion. No isolated staging environment has been verified or authorised. Authenticated before/after captures, Nuvio playlist/guide import and protected playback, and a runtime rollback rehearsal remain pending. The current Cloudflare deployment identifiers require verification before a production promotion. International presently has a Regional v4 QA destination. Supabase and the customer-facing routes were untouched.

## Phase 4 release acceptance

**NO-GO for both targets on 20 November 2026 NZDT.** Supabase metadata still matches the 15 pinned bundles. The downloaded source matched all 45 digests for `n` v37, Plus v5 and Regional v4, and both International broker/ingest entrypoints matched their pinned digests. Both baseline staging commands passed offline validation and rejected the missing isolation and owner approval records. The existing Regional QA path shares the production Supabase project. The three protected entrypoints all contain the production Supabase URL fallback.

Use an unlinked local Supabase stack on a private QA LAN as the no-cost staging candidate. Verify database, Vault, guide storage, cron, route and egress isolation from both the runtime and the Nuvio device before seeking approval for the exact environment and manifest. No staging runtime or authorised capture was exercised in this pass. See the [acceptance audit and Nuvio checklist](phase-4/ACCEPTANCE.md) and [release history](phase-3/HISTORY.md).

Drafts #11–13 contain no serving source or static feed changes. An eventual merge to `main` can still trigger GitHub Pages publishing, as observed for the current `main` SHA. Keep the drafts unmerged pending separate approval and a publishing settings check. Production functions, routes and customer accounts were untouched.

## Phase 4A staging preflight

**Blocked before setup on 20 November 2026 NZDT.** The connected workspace cannot administer or test the physical QA network. Offline replay with a non-production Supabase origin still emitted production TVNZ licence URLs for every profile and production playback URLs for Plus. Source inspection also found a direct production Sky guide call in XMLTV v24. See the [host setup and verified route blockers](phase-4/ACCEPTANCE.md#phase-4a-local-staging-preflight). No candidate was deployed. The pinned production baselines and rollback reference are unchanged.
