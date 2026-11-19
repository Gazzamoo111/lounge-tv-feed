# Phase 4 release acceptance

**20 November 2026 NZDT | NO-GO for staged acceptance and production promotion.** Scope is standard NZ/AU `n` v37, account-scoped Plus v5 via `n`, and International Regional v4. This record follows [Issue #10](https://github.com/Gazzamoo111/lounge-tv-feed/issues/10) and the [Phase 3 runbook](../phase-3/RELEASE.md).

## Verified evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Deployed source and versions | PASS | Supabase reported 15 pinned versions, package digests and JWT/import-map flags matching Phase 1. Independently hashed 14 `n`, 15 Plus, 16 Regional, one broker v8 and one ingest v14 file. All matched. |
| Offline regression | PASS | 11 Python validators, 9 release gate tests, 34 Node tests, three synthetic profiles and five synthetic guide projections. Both baseline manifests regenerated exactly. |
| Runtime and device isolation | BLOCKED | The existing QA functions use the production Supabase project. It reported 22 active cron jobs, one bucket and 37 Vault entries. Supabase listed zero development branches and no active separate project. The audit runner had no Supabase CLI or container runtime. A private device network and its deny rules were not available for verification. |
| Staging approval and gate | BLOCKED | Issue #10 had no staging approval comment. Running `stage` against both baseline manifests with staging and approval absent passed automated validation, then exited 1 with both blockers. The CLI validates the evidence record shape. The operator must independently verify runtime isolation and the GitHub approval. |
| Authenticated playlist and EPG | NOT TESTED | No authenticated routes were exercised. Real counts, category differences, EPG mapping, now/next and failures remain unmeasured for standard, Plus and Regional. |
| Actual Nuvio import and playback | NOT TESTED | No QA device session or playback receipts. |
| Rollback | OFFLINE PASS, RUNTIME NOT TESTED | Restored the three pinned gateway bundles across both scopes, verified source identity and uninterrupted peer scope, and matched synthetic before/after responses. No staging deployment or post-restore authenticated checks took place. |

Both baseline plans use source `ac6b50abf10af3831b3eeb937354f9abac7e36c4`. These hashes identify the audited plans. Recompute the digest for any later candidate.

| Target | Manifest SHA-256 |
| --- | --- |
| NZ/AU including Plus | `4bd96ed61eadfa176b5ee48c7660d1630fd56f7b2366e67ff521d662bd5a712a` |
| International Regional | `c19097817e830ce1e730772f06129015474e371bbd1c5e5a5285e83bd130c8f0` |

## Staging isolation and approval

Use [local Supabase](https://supabase.com/docs/guides/local-development) on a private QA LAN that the Nuvio device can reach. This avoids hosted branching charges and provides control over outbound traffic. Verify the following on the actual staging host and device before deploying a gateway or running authenticated checks.

1. Confirm the work directory is unlinked from the hosted project. Inventory an independent database, QA-only Vault bindings and service assignments, local role keys, a QA guide bucket, local shared-guide state and no production cron targets. Keep synchronisers disabled unless their targets and writes have been independently verified as local. Use only authorised QA inputs and assignments. Existing International QA credentials and broker bindings on the production project establish a dependency, but their presence does not establish isolated QA account availability for all three profiles.
2. Bind `SUPABASE_URL` and `SUPABASE_DB_URL` to the local services. Confirm Regional's storage/service-role binding is local. Preserve function slugs and give standard and Plus the same isolated gateway origin. Verify local DNS/Host routing, generated playlist/guide URLs, the authorised licence destinations and every playback redirect hop. Block the production Supabase API and database, production aliases, and any unauthorised upstream. Allow only approved QA provider, guide, licence and media hosts. From both the runtime and the device network, exercise outbound denies with credential-free probes. Include the hard-coded production URL fallback in `n`, Plus and Regional. From the runtime, verify an omitted staging URL cannot result in a successful production call. A successful production-origin probe from this audit runner returned HTTP 404 for a nonexistent function, so it cannot serve as evidence of a blocked outbound boundary.
3. Have `Gazzamoo111` post explicit staging approval on Issue #10 for the target, canonical manifest digest and identified isolated environment. Verify the actual comment author and timestamp. Then run the existing `stage` gate and apply only the approved scoped bundle. Any production approval is a distinct later action. International currently has no verified production destination.
4. Capture the authenticated exports and compare before/after/restore using the [Phase 2 validator](../phase-2/REGRESSION.md), the same QA accounts per profile and documented UTC comparison times. Record actual category order, counts, ID/icon/duplicate changes, guide branch, eligible/mapped/current/next counts and invalid IDs or times. Keep the raw data, catalogue projections and detailed private evidence on the operator machine. Use only redacted aggregates in GitHub.
5. After candidate acceptance, restore the selected affected bundles and settings from [Phase 1 recovery](../phase-1/RECOVERY.md). Verify source and config parity, expected route and peer inventory, stable playlist and category IDs/order, and equivalent guide behaviour accounting for natural schedule movement. Recheck Nuvio after restoring. When the candidate and rollback pins are identical, identical redeployment alone does not establish that an observable candidate regression can be reversed. Record any separately approved staging-only change used to demonstrate state restoration.

## Nuvio device acceptance

Run on a supported Nuvio + IPTV device using the approved isolated routes and dedicated QA accounts. Record device model, app build, NZDT timestamp, profile, test result, startup time and any buffering, looping, error or metadata mismatch. Use a QA-only profile or installation. Keep URLs, tokens and credential-bearing screens out of the evidence posted to GitHub.

| Profile | Verify on device |
| --- | --- |
| Standard NZ/AU and Plus, each separately | Import through the isolated gateway. Confirm the expected Xtream fallback reaches the DRM-aware M3U and the correct standard or Plus categories appear. Refresh the staged guide, check now/next on TVNZ 1, a Sky Sport channel and an AU channel against the staged XMLTV, and confirm the guide does not add duplicate visible channels. Confirm the standard login does not pick up Plus categories. |
| Standard NZ/AU and Plus, each separately | Play TVNZ 1 and TVNZ 2 for two minutes each, then switch away and back. Check picture, audio and restart. Tune every Sky Sport channel 1–9 for at least 30 seconds each and watch Sky Sport 1 and 9 for two minutes each. Record stalls and repeat loops separately from startup. |
| Standard NZ/AU and Plus, each separately | Play the staged ABC TV, 7, 9 and 10 entries and compare one regional variant with its main feed. Test Fox Sports or Kayo entries when supplied by the QA assignment and record any provider failure against the exact entry. |
| International Regional v4 | Import the Regional playlist and XMLTV, confirm the distinct region groups and no duplicate visible channels after guide refresh. Play one UK general channel and one UK sports channel, one US general channel and one US sports channel, and a country or regional variant from another group. Check UK/US guide now/next and the variant's regional label. Record exact channel labels from the staged catalogue. |
| After the restore | Re-import or refresh the affected staged profile and guide to avoid relying on cached data. Retest the previously verified affected playback paths and guide samples. Record the restored route, any change in player behaviour and the peer profile check. |

## Merge audit

- Draft #11 adds source recovery and operations records. Drafts #12 and #13 add or update the offline regression workflow and its tooling/configuration. The exact three diffs add no serving gateway, Worker, static feed asset or schema changes.
- The two legacy EPG refresh jobs have scheduled/manual triggers and push path filters. None of the draft paths match either filter. The legacy feed rebuild is manual on `main`. The branch-scoped QA workflows do not match the draft paths or bases. Draft #13 into #12 would run the offline regression push checks on the Phase 2 branch. After the full stack reaches `main`, the added workflow can run for proposals, with read-only repository permissions and no deployment step.
- GitHub's public deployment records show a `github-pages` deployment on `main` at `69c7a771b13242b24c0771af2e5493969f2a9e43` (deployment `7921945186`) and previous `main` deployments. A merge ultimately reaching `main` can therefore trigger a Pages rebuild. The draft diffs contain no changes to checked-in public feed assets. The Pages source folder setting and external Cloudflare/Git integrations could not be independently verified. Verify these from the dashboards before separate merge approval.
- All three PRs remained drafts and unmerged. No staged or production functions, routes, schedules, public feeds or customer settings were changed in this audit.
