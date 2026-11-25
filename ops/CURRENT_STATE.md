## First operator registration accepted | 25 November 2026 NZDT

Issue #33. Owner supplied screenshot of production provisioning page showing 'Account registered. Playback still needs verification.' and generated customer credentials after submitting a separate demo provider line. Browser access and authorised registration confirmed by owner screenshot; existing insert code requires success and one changed D1 row to return 201. No credentials copied to repository. Active version last verified e0bce7dc-8f2d-45bd-80e2-0f8f14978882. Next verify Xtream login, catalogue, EPG and real-device playback using separate test playlist without disturbing owner playlist. Screenshot credentials are test-only and should expire/revoke; operator token must be rotated privately before commercial use. No additional deployment or database changes by operator in this task. Rollback original live-only version 8a90126d-709e-4f18-bd6c-1b631ac05bc4.

---

## Operator secret activation verified | 25 November 2026 NZDT

Issue #33. Owner reported dead link after adding secret. Dashboard read confirms encrypted PROVISION_ADMIN_TOKEN present. Read-only run [45565149521](https://github.com/Gazzamoo111/lounge-tv-feed/actions/runs/45565149521), job 139038016829, confirmed active Worker e0bce7dc-8f2d-45bd-80e2-0f8f14978882 at 100%, token configured as secret_text, all other binding metadata and runtime match original. Existing health/auth checks passed. Both release and Chrome user-agent requests to operator form returned HTTP 200 with expected marker; HTML/JS and unauthorised POST checks passed. No deployment or account changes performed. Actual browser access and authorised registration remain unverified. Owner instructed to paste direct URL in a fresh tab. Previous known-good live-only rollback 8a90126d-709e-4f18-bd6c-1b631ac05bc4; locked form version 088b71de-0d7d-496e-b3a6-32c5cd0711ef. Token value previously shared in chat must be privately rotated before commercial use.

---

## Locked provisioning form deployed | 25 November 2026 NZDT

Issue #33. Guarded retry [45560276102](https://github.com/Gazzamoo111/lounge-tv-feed/actions/runs/45560276102), job 139022050712, deployed already-uploaded version 088b71de-0d7d-496e-b3a6-32c5cd0711ef at 100%. All 28 tests passed, binding/runtime parity passed, existing public health and auth denial checks passed, operator HTML and JS returned expected content, unauthorised registration denied at application boundary. Retry used established probe headers and more precise diagnostics; exact earlier HTTP failure cause remains unconfirmed. Form available at https://tv.loungetv.nz/operator/provision; registration locked until owner configures separate strong PROVISION_ADMIN_TOKEN secret on active Worker. No live account created, no actual new-customer device test, no changes to R2/D1/EPG or Supabase. Rollback version 8a90126d-709e-4f18-bd6c-1b631ac05bc4. Before adding secret ensure dashboard active version is 088b71de and no VOD flags reintroduced. After secret activation verify live health, unauthorised rejection and authorised registration with a valid separately authorised test line. Never share token in chat or GitHub.

---

## Provisioning release rolled back | 25 November 2026 NZDT

Issue #33. First candidate 0cc3fcb8-9987-45b2-aa19-2e1be36c9207 was blocked by extra binding names; no activation. Removed keep-vars for second candidate 088b71de-0d7d-496e-b3a6-32c5cd0711ef, run [45558652469](https://github.com/Gazzamoo111/lounge-tv-feed/actions/runs/45558652469), job 139016732745. All 28 tests passed, exact existing binding and runtime parity passed. Existing public health and invalid-auth checks passed before and during candidate activation. New operator route check failed three times with HTTPError (actual status not retained by original diagnostic). Automatic rollback restored original Worker 8a90126d-709e-4f18-bd6c-1b631ac05bc4 at 100% and public checks passed. No real customer registered, no operator token configured, no changes to live/EPG data or D1. Next isolate operator route HTTP status, request origin and Cloudflare edge behaviour with non-secret diagnostics before further deployment. Do not blindly redeploy or weaken authentication. Owner does not need to change GitHub settings. Current provisioning remains manual.

---

## Secure provisioning interface | 25 November 2026 NZDT

Issue #33. Owner authorised reducing manual per-customer account registration. Isolated branch `feature/secure-provisioning-20261125` based on original live-only Cloudflare branch, not VOD migration. Implemented `/operator/provision` and static JS using existing D1/HMAC/AES-GCM bindings; separate randomly generated customer credentials, provider expiry and 1/2 connections, create-only D1 insert, bounded JSON, same-origin POST, strong separate bearer secret, no browser storage or credential logging. Existing account cannot be overwritten. Regression run 45558441099 passed. Guarded release commit `ed9bc33848bd4ad615f141649f4411ff0cc35389` run 45558534999 verifies original active version, exact binding/runtime parity, smoke checks and rejects unauthorised provisioning. Rollback original Worker `8a90126d-709e-4f18-bd6c-1b631ac05bc4`. Release pending at this record. Separate `PROVISION_ADMIN_TOKEN` secret must be configured by owner before live form accepts requests; no real customer created or tested. Provider entitlement and expiry remain operator responsibility; renewals/revocation manual. No Supabase changes.

---

## Isolated Cloudflare production deployed | 23 November 2026 NZDT

Issue #25 is open. The production acceptance origin is **https://tv.loungetv.nz**. Worker `loungetv-xtream-production` is on version `8a90126d-709e-4f18-bd6c-1b631ac05bc4`. It uses dedicated D1 `loungetv-xtream-production` and private Standard R2 `loungetv-xtream-production-private`, with independent authentication and encryption secrets. The bucket has public and custom domains disabled. The production Worker has its workers.dev and preview endpoints disabled.

- Verified 3,267 immutable objects against QA, with byte parity for the playlist, channel metadata and full guide. Live HTTPS returned the exact QA catalogue and M3U, **25 categories, 13,083 entries, 64 Australian entries and 6,756 events/PPV**. Category `🏆 Live Sport | Events & PPV` is last. The catalogue is `v20261123-deduplicated25-au9`, paired with XMLTV `v20261123-issue22` (2,849 guide channels and 187,840 programmes). Both compressed and uncompressed XMLTV and a 12-stream short EPG sample passed.
- A unique production owner login was created and verified over HTTPS. Direct BEST account authentication returned active and non-trial with a confirmed expiry and one connection. The existing login is still valid on the legacy host. The owner approved the HTTP hop to the configured BEST hostname for this line on the isolated origin. The provider's catalogue returned 12,974 of the 13,078 approved BEST IDs, including all four playback samples. The curated catalogue is intact.
- Account creation, incorrect credentials, expiry, renewal with the same login and revocation passed live against synthetic accounts. All synthetic accounts used for checks were disabled afterward. Real provider renewals and simultaneous playback at the sold connection limit remain to be verified. The gateway reports the allowance in Xtream; the provider applies the stream connection limit.
- Sky Sport 1 delivered MPEG-TS from BEST after the HTTPS gateway redirect. AU Channel 7, BBC One London and US ABC HD returned the expected HTTPS gateway and BEST redirects. The playback runner's automatic approval review blocked further checks through a different HTTP CDN address. Three, Whakaata Māori and Te Reo returned HLS manifests and HTTP 206 media. Both TVNZ channels returned 302 to their expected DASH sources and 403 when the runner requested the manifests. Physical Nuvio playback, Widevine and Sports Hub with the event group hidden remain acceptance gates. Group Order and Channel Order are local Nuvio settings. Setup Sync restores an individual user's settings.
- Production EPG workflow and frozen mapping support are on the feature branch. A read-only production compile found 24 approved guide IDs without current or upcoming programmes, and the active guide remained unchanged. Scheduled publication is disabled. Activation requires a passing full source compile, a bucket-scoped credential and a workflow available on the default branch.
- Conditional update and exact restore of the production R2 pointer passed. A stale write returned HTTP 412. The R2 recovery pair remains `{"release":"v20261123-deduplicated25-au9","epg_release":"v20261123-issue22"}`. The preceding isolated Worker version is `49e2154d-75a7-44d5-8687-cad5f4d6d38f`, which disables BEST playback. The legacy custom domain still binds to `lounge-tv-xtream`, current version `e49ecfc4-45d4-4eba-b6c5-31f4e695c132`, and live HTTP shows Supabase function traffic.
- Supabase retirement checks are read-only. The project remains in service. All 22 scheduled jobs and their 14 active states remain as found. Before cutover/retirement, complete device acceptance, sustainable EPG refresh, remaining entitlement reconciliation, verified backup and restore, and dependency checks for activation, billing/renewals, administration, website and monitoring.

Nuvio acceptance follow-up: a device login attempt paired the legacy Xtream credentials with the isolated hostname and showed a login error. Rechecked the separate production credentials over HTTPS: authentication passed, invalid password was rejected, and the 25-category / 13,083-entry M3U and approved XMLTV passed. A separate Nuvio playlist using the new login remains the device acceptance step. No service changes or rollback.

## Australian Channel 9 cleanup live in QA | 23 November 2026 NZDT

Verified immutable QA R2 release `v20261123-deduplicated25-au9` on Worker `ad8494b3-1905-4205-99dd-4af8c25c08a4`. Applied the guarded PR #24 script from `66248ffe78e038847718e3ea60fd66ab96788b2a` to the exact active phantom-fixed catalogue `v20261123-deduplicated25-ppv-meta`. Dry run, application and idempotence passed. Only 9Now RAW QLD `1921340`, VIC `1921345` and WA `1921330` were omitted from the QA browse feed. Channel 9 Sydney and Perth and distinct Nine stations remain. All retained stream rows and M3U blocks are exact.

Live HTTPS verified **25 categories, 13,083 entries, 64 Australian entries and all 6,756 PPV entries**. Category 25 `🏆 Live Sport | Events & PPV` is last in the returned playlist and Xtream category list with no phantom ZZ entry. PPV category bytes and the XMLTV match the prior QA release. Redirects for the corrected PPV event, both kept Channel 9 feeds and TVNZ 1 are identical. The server continues providing all events to Nuvio. Physical profile controls were not accessible: selecting Playlist order, hiding the PPV group in Live TV and verifying that Sports Hub can still find an event while hidden remain device checks.

QA Worker, D1, credentials, production and Supabase were untouched. Rollback is a conditional QA `current.json` restore to `{"release":"v20261123-deduplicated25-ppv-meta","epg_release":"v20261123-issue22"}`.

## Phantom PPV category repair verified live in QA | 23 November 2026 NZDT

QA serves new immutable catalogue `v20261123-deduplicated25-ppv-meta`. Applied `fix_ppv_group_metadata.py` from PR #24 commit `89626c0a892bec29bf2802e8444d737efaf30bec` to a fresh snapshot of active `v20261123-deduplicated25`. Dry run, application and idempotent rerun passed. The sole event display name change is for stream 2189718. Exactly three of 28 QA catalogue objects changed, including exactly one M3U EXTINF line. Category definitions and order, original canonical logo, all stream IDs, all URLs, PPV row order, and every other item field remained exact.

Activated with an ETag-conditioned QA R2 pointer switch, keeping EPG release `v20261123-issue22`. Verified authenticated live HTTPS Xtream categories and the full M3U, with exactly 25 categories, 13,086 streams, 6,756 PPV entries, one group-title per EXTINF, and no legacy ZZ group. Both served sources have `🏆 Live Sport | Events & PPV` last. The live gzip XMLTV and exact redirects for the repaired PPV event, Sky Sport 1 and TVNZ 1 matched the pre-change checks. Nuvio's physical refresh and client-side sorting were not verified.

QA Worker remains `ad8494b3-1905-4205-99dd-4af8c25c08a4`. Worker, D1, account bindings, production and Supabase were untouched. Rollback is a conditional QA `current.json` restore to `{"release":"v20261123-deduplicated25","epg_release":"v20261123-issue22"}`.

## QA catalogue deduplication and protected PPV | 23 November 2026 NZDT

QA now serves immutable R2 catalogue `v20261123-deduplicated25` on Worker `ad8494b3-1905-4205-99dd-4af8c25c08a4`. The EPG pointer still uses `v20261123-issue22`. Verified 25 categories in the approved sequence with the original emojis and flags, ending in `🏆 Live Sport | Events & PPV`. The label changed from `🏆 Live Events`; its category ID stayed 25.

- 13,086 customer-visible entries after hiding 211 extra variants in 80 groups. For confirmed same-channel groups, kept the preferred known or entitled quality and a useful second feed when available. Matching retains market, affiliate, time-shift and regional qualifiers; ambiguous sources remain distinct. All 67 AU entries and 181 US Local & Regional TV entries were retained. UK Sky Sports Main Event was reduced to 1905853 and 1458672, both tested for media.
- All 6,756 live PPV JSON records matched the former QA release byte for byte. The only PPV M3U metadata edit is the category label. All PPV IDs, URLs, channel names, logos, icons, flags, order and guide mappings remain exact. All retained non-PPV stream rows and M3U blocks, including all five NZ Freeview IDs and both Widevine metadata blocks, matched the prior release.
- Live HTTPS QA accepted the known login and rejected a bad password. The returned category JSON, 13,086-entry M3U and existing gzip XMLTV matched the expected bytes. All nine sampled route targets, including the five Freeview/TVNZ paths, were identical before and after.
- Short media verification decoded 25 frames each from Sky Sport 1, BBC One London, US ABC HD, UK Sky Sports Main Event FHD and its HEVC backup. AU Channel 7 HD still returned HTTP 407 at the redirected media host after BEST returned 302. There was no media body. The unchanged route and prior observed 407 separate this playback issue from catalogue edits. No physical Nuvio, sustained playback or new TVNZ licence grant was verified.
- Existing automated checks passed (24 JavaScript and 10 Python). No changes to Worker code, D1, provider bindings, production or Supabase. Rollback is a conditional QA-only `current.json` restore to `{"release":"v20261123-premium25-nz5","epg_release":"v20261123-issue22"}`. All previous immutable catalogue objects are retained.

## BEST trial bound and tested in live QA | 23 November 2026 NZDT

The fresh private provider export matched 13,187 of 13,292 approved BEST IDs, including all four requested samples. Existing account `lounge-tv-qa` is bound through its AES-GCM encrypted provider fields on QA D1. Worker `ad8494b3-1905-4205-99dd-4af8c25c08a4` inherits the existing auth secret and uses the approved trial origin and a versioned encryption key. The Worker source matched the previous deployed source. Existing QA login, expiry and connection allowance were preserved. No other account provider fields were populated.

| Channel | QA | BEST entry origin | Media host result |
| --- | --- | --- | --- |
| Sky Sport 1 FHD (2024778) | 302, exact approved provider path | 302 | HTTP 200, H.264 video and AAC audio, 30 frames decoded on repeat |
| AU Channel 7 HD (738209) | 302, exact approved provider path | 302 | HTTP 407 on two checks, zero media bytes |
| BBC One London (392911) | 302, exact approved provider path | 302 | HTTP 200, H.264 video and AC-3 audio, 30 frames decoded on repeat |
| US ABC HD (45439) | 302, exact approved provider path | 302 | HTTP 407 on two checks, zero media bytes |

The two repeat failures occurred on redirected media hosts and were reported via Envoy without a Proxy-Authenticate header. HTTP 513 did not recur in these playback checks. This evidence locates the failure after the BEST entry redirect and does not establish a provider-side IP restriction. Physical Nuvio playback and sustained playback were not tested in this task.

The public QA M3U and guide matched the approved bytes. All 25 categories, 13,297 visible entries and 6,756 PPV entries were preserved on the same R2 release `v20261123-premium25-nz5`. All 24 JavaScript and 10 Python checks passed. Production and Supabase were untouched.

Rollback for this QA-only config change: restore Worker `97c9cb65-0fe0-4446-9a4a-c84349d61667` and clear only the two trial provider fields for the QA account. Leave QA auth, expiry, connection allowance, D1 stream IDs and R2 pointers unchanged.

## Fresh BEST trial verification blocked | 23 November 2026 NZDT

The reseller screenshot reported the fresh trial as enabled with a 24 November expiry. The approved BEST origin returned HTTP 503 over HTTPS without an Xtream response. After explicit approval for the fresh trial at that exact HTTP origin, direct requests to the account API, playlist export and approved Sky Sport 1 stream returned HTTP 513 with zero response bytes. No provider status, bouquet, stream IDs or media could be read. The supplied trial was not assigned, and no Sky Sport mapping was edited.

QA remained on Worker `97c9cb65-0fe0-4446-9a4a-c84349d61667` with R2 `v20261123-premium25-nz5`. The QA login worked, D1 still had no assigned provider line and the same 25-category catalogue remained active. Both TVNZ routes still returned HTTP 302 over QA with DRM playback unverified. No production, customer or Supabase changes.

## Supplied account verification and live playback checks | 23 November 2026 NZDT

The supplied account authenticated at the existing HTTPS Lounge TV gateway with HTTP 200, `auth=1`, status `Active`. The gateway exposes Lounge TV public stream IDs. The latest read returned 2,988 public IDs, with no direct overlap against the 13,292 approved BEST IDs. Inspecting authorized HTTPS playback redirect metadata without following the upstream redirects confirmed the approved provider IDs for AU Channel 7 HD and US ABC HD. Sky Sport 1 resolved to different IDs and BBC One London was absent from the exposed catalogue. These samples do not establish the complete BEST entitlement set.

The approved provider origin did not return a usable HTTPS Xtream response. Direct verification against its plaintext HTTP endpoint was blocked by automatic approval review. There was no explicit approval to transmit this account's credentials over HTTP. The account was not assigned in QA D1.

Live QA playback returned HTTP 503 `temporarily_unavailable` for Sky Sport 1 FHD (2024778), AU Channel 7 HD (738209), UK BBC One London (392911) and US ABC HD (45439). Both TVNZ QA playback links returned 302 to the approved DASH manifests. Connected Chrome blocked both final TVNZ manifest requests with `ERR_BLOCKED_BY_CLIENT`, before a Widevine challenge or licence grant. DRM playback was not verified.

Reconfirmed all 25 categories, the exact approved 13,297-entry M3U and the 6,756 Live Events entries, plus the exact XMLTV in gzip and plain XML. QA continued on Worker `97c9cb65-0fe0-4446-9a4a-c84349d61667` and R2 `v20261123-premium25-nz5`. No deployment, production, customer or entitlement changes. The rollback baseline remains the one recorded below.

## Premium 25 and NZ Freeview live QA | 23 November 2026 NZDT

The authorised QA release is active at `https://xtream-qa.loungetv.nz`. The Worker `loungetv-xtream-standalone-qa` uses version `97c9cb65-0fe0-4446-9a4a-c84349d61667` from source commit `e7229194084e9ccca02cff293ccc5fcc0561e7db`. Private R2 `current.json` points to catalogue `v20261123-premium25-nz5` and the byte-identical existing EPG `v20261123-issue22`. Added five whitelisted IDs to QA D1, which now has 14,722 permitted IDs. No QA or production account rows were edited.

- The live HTTPS Xtream login accepted the QA account and rejected an incorrect password. All 25 ordered categories and the exact 13,297-entry M3U passed. Native `get_live_streams` deliberately returns 503 with the QA DRM fallback flag. `get.php` returned 200 with both TVNZ Widevine entries. Nuvio's client retry was not tested.
- All 6,756 Live Events are byte-identical to the previous curated preview. The original event IDs, names, logos, guide IDs, links and event order were also preserved. Both gzip and plain XMLTV returned HTTP 200 and matched the approved guide (2,849 IDs, 187,840 programmes). The five new NZ channels have no guide mappings.
- All five NZ stream endpoints returned 302 to the exact approved manifests. Three, Whakaata Māori and Te Reo returned HTTP 200 with HLS playlists upstream. Both TVNZ manifests returned HTTP 403 from this runner. Both licence endpoints returned HTTP 502 for an invalid Widevine challenge. Unauthenticated requests returned 401, empty requests 400, oversized requests 413, unsupported channels 404, wrong methods 405 and preflight 204. No licence grant or sustained device playback was verified.
- The BEST HTTP code correction is active on QA. BEST's HTTP account API returned 200 with `auth=1` and account status `Expired` for the approved test line. The expired line was not assigned. The live QA BEST sample returned HTTP 503 and needs an active dedicated line with matching stream IDs.
- Rollback restored Worker `4723ac7c-1176-4495-b5be-784e8554dab3` and the exact prior pointer `{"release":"v20261123-issue22"}`, which served 37 categories with the new NZ routes inactive. The candidate was then restored and the 25 categories and TVNZ redirect rechecked. The five additive QA D1 IDs were retained.
- Local checks passed 24 JavaScript tests and 10 Python tests. Scheduled EPG refresh stays inactive. Production remains on the same `connect.loungetv.nz` route to Supabase and returned its existing unauthenticated HTTP 401. No production, customer or Supabase edits were made.

## Standalone Xtream QA | 23 November 2026 NZDT

[Issue #23](https://github.com/Gazzamoo111/lounge-tv-feed/issues/23) / [draft PR #24](https://github.com/Gazzamoo111/lounge-tv-feed/pull/24). The isolated Cloudflare Worker `loungetv-xtream-standalone-qa` serves `https://xtream-qa.loungetv.nz`, version `4723ac7c-1176-4495-b5be-784e8554dab3`. D1 `loungetv-accounts` contains 14,717 permitted stream IDs. Standard-tier R2 `loungetv-xtream-private` has public access disabled. Its initial pointer is `{"release":"v20261123-issue22"}`. Both bindings are QA-only. The application has no Supabase dependency.

HTTP QA authenticated the dedicated test account and verified rejection for incorrect, expired and revoked logins. A separate QA account was enabled, accepted by the live API, disabled and rejected again. Catalogue, ordered categories, M3U, short EPG and full XMLTV matched the approved private data. The 72.88% compilation had 3,235 current-or-next matches out of 4,439 eligible entries, across 2,849 XMLTV IDs and 187,840 programmes. A conditional pointer update and rollback succeeded with the catalogue available throughout.

The dedicated account supports Nuvio catalogue and EPG testing. Provider playback is blocked pending a verified HTTPS BEST line with matching bouquet and stream IDs. The approved M3U origin was supplied as HTTP on port 80, and HTTPS probes did not establish provider access. No physical Nuvio acceptance or sustained playback is recorded. The draft branch includes scheduled refresh code and durable private mapping inputs. An online compile parsed all 27 upstream feeds selected by the verified mappings. Four guide IDs lacked current or upcoming programmes, so the validation gate rejected the refresh and the deployed guide stayed active. Scheduling is inactive pending an approved default-branch workflow and bucket-scoped GitHub Actions credentials. Production cutover and customer/account migration are pending.

Rollback baseline: set the QA R2 pointer back to `{"release":"v20261123-issue22"}` using a conditional write and retain Worker version `4723ac7c-1176-4495-b5be-784e8554dab3`. This is the first QA version and no preceding QA Worker rollback exists. Current production routing through `connect.loungetv.nz` and Supabase was preserved.

## Sky Sport NZ playback incident | 22 November 2026 NZDT

Owner reports Sky Sport NZ 1–9 stop after approximately 30 seconds. This supersedes the 21 November acceptance for those channels. [Issue #20](https://github.com/Gazzamoo111/lounge-tv-feed/issues/20) is open. Standard gateway remains **n v39**. Deployed entrypoints match main, and Sky live returns a BEST redirect. [Draft PR #21](https://github.com/Gazzamoo111/lounge-tv-feed/pull/21) head `55b4347` fixes HD backup ordering and scopes HLS opt-in to Sky Sport NZ. Handler fixtures and [CI](https://github.com/Gazzamoo111/lounge-tv-feed/actions/runs/44920978868) passed. That PR remains undeployed. Authenticated BEST duration, concurrent sessions and 10-minute Nuvio acceptance remain pending.

A separate owner-only Supabase M3U, `lounge-sky-rugby-qa` v1, was deployed for on-device comparison. It uses the existing Plus account verifier with a single Vault read and direct BEST playback. Source is pinned at `bbc0d082e7194b3fc6d7aae658b9e8e8af487728`. Local fixtures passed and the running endpoint rejected missing and invalid credentials. Production n v39 / Plus v6 were untouched. Authenticated Nuvio playback and the 10-minute acceptance test are pending. Remove the standalone QA function to withdraw the test feed.

Owner reports pauses approximately every 20 seconds and requested the fix on the existing Xtream login. Deployed **Plus v7** (bundle `bee6ef02ac3ac362e7c4561ccec045e35f348ef2d1e8a7828accb28f62845685`) as an owner-only playback trial. It redirects the same Sky Sport 2–8 live IDs from the known regional/FHD routes to distinct BEST HD TS sources after checking the existing Plus verifier. Sky Sport 1/9 remain on their existing HD sources. Non-owner, other channels, playlist and guide behaviour retain their v6 routes. Standard `n` stays v39. Handler isolation checks passed and all 16 deployed files matched readback. No sustained playback is confirmed. Reopen the channel without refreshing. Rollback is the [Plus v6 bundle source](https://github.com/Gazzamoo111/lounge-tv-feed/tree/2d729001115c04fb3402f31359696bb164f8d81a/production/plus). Trial source `12f59a0d5ba505b30ea9de03a6bc703a286199c4`.

Owner clarified that Sky Sport 1 is affected. **Plus v8** scopes the same-login playback trial to the owner’s Sky Sport 1 only, switching BEST HD `636918` to FHD `2024778` over TS. Sky Sport 2–8 return to the pre-trial routes and Sky Sport 9 retains its prior route. Other accounts and catalogue/EPG are unaffected. Isolated handler checks and 16-file deployed readback passed. Device playback remains pending. [Rollback source for v6](https://github.com/Gazzamoo111/lounge-tv-feed/tree/2d729001115c04fb3402f31359696bb164f8d81a/production/plus). Trial source `814ee0da3981ee77680ed3e54455a4ba0819f4bc`.

## Owner Nuvio device acceptance | 21 November 2026 NZDT

The owner reports the existing Lounge TV Xtream connection with **production n v39 / Plus v6 is working perfectly** after the category and EPG updates. Treat this as **user-observed device acceptance of the current configuration**. The excellent EPG coverage, working playback and category presentation should be preserved. This is not independent automated verification of every channel, a fresh-customer provisioning test or evidence that every EPG gap is resolved. Do not change the working feeds as part of cleanup. The earlier reported missing Premier Sports/beIN/movie/documentary schedules remain research opportunities, not launch blockers based on this report.

---

## Category-only v39 update | 20 November 2026 NZDT

**Serving gateway:** Supabase `n` **v39 ACTIVE**, bundle `14d7c1bf0b1f89fb76d137b55df876fa7d2706564485d265b0617f34c6349d01`, 16 source files. **Plus:** `lounge-plus-qa` **v6 ACTIVE**, bundle `1dbe8638c928b41cc9e4f1d6593bb8343d4e1a8ecc3a73d2bd0f1c36ad98d9c7`, 15 source files. Released from merged [PR #19](https://github.com/Gazzamoo111/lounge-tv-feed/pull/19) head `2d729001115c04fb3402f31359696bb164f8d81a`.

- Source readback matched all 31 deployed files after the two-function release. No DB, stream routing, account auth, TVNZ DRM, Sky Sport routing, `direct-epg.json` or three-guide configuration changed.
- Added Movie Streams for UK Sky Store and US Cinemania/CM Hollywood plus one UK Cinemania Hollywood channel. Permanent movie networks stay in Movie Channels.
- Plus visible category names no longer include literal `&`, preventing `&amp;` rendering. Existing channel and category IDs stable. UK/US sports event feeds now classified explicitly.
- Direct JavaScript regression and invariants passed **19/19**. **Owner Nuvio device acceptance was reported on 21 November 2026**; production source parity and owner feedback do not establish independent channel-by-channel verification.
- Rollback source: archived `n` **v38** and `lounge-plus-qa` **v5** under snapshot commit `166d8eaee86cf8e3462fa70e781263290de867cb`. Former v37 also preserved. Restore both 16-file/15-file bundles together if category import is defective; do not restore v36.
- **Unresolved guide gaps:** Premier Sports, several beIN, some movie networks and documentaries lack verified programme data under current source/mapping. The earlier 967 guarded remappings are unchanged. Missing upstream schedules require separate verified matching in Issue #10; do not assign unrelated schedules.

---

# Lounge TV previous production state | 20 November 2026 (v38 historical reference)

**Authoritative serving source:** `production/n/` copied from ACTIVE Supabase Edge Function `n` v38, bundle digest `c67dd009bd4089e3897d6921063c8608353293de8b39bc7450e84344a6a8637e`. The authenticated public hostname is `https://n.loungetv.nz` (historically confirmed via Worker/origin logs). Post-release custom-domain and physical-device checks are not yet independently recorded.

**Plus:** `lounge-plus-qa` v5 (digest `9820504273ca9e5676fc30bcc9fbe7a6e11ecf6640e7e014db30381af37ee39b`) remains a separate deployed function; `n` v38 delegates the assigned Plus subscription and decorates its existing internal M3U fallback. Plus v5 was not redeployed for this update.

**Working EPG candidate deployed:** PR [#16](https://github.com/Gazzamoo111/lounge-tv-feed/pull/16), SHA `e4c758bb4c866c8ba8786681c105742ab48a3188`, with 967 guarded remappings, canonical guide then epg66 and epg64, and `&amp;` category-label correction. Existing stream URLs, IDs, category order, authentication and TVNZ DRM paths were preserved in source; the pre-release authenticated QA comparison passed. The production source was read back after deployment and matched PR #16.

**Rollback:** frozen `n` v37 (14 source files, digest `ea170d5bc88cb65cc58a46cd5172d352921c7f03eaa82a2b57f7f6ee62790e1c`), [snapshot commit `166d8eae`](https://github.com/Gazzamoo111/lounge-tv-feed/tree/166d8eaee86cf8e3462fa70e781263290de867cb/n-v37-rollback). Preserve current bindings and `lounge-plus-qa` v5. This is source recoverability, not a completed rollback rehearsal. Never restore v36 in place of v37.

**Core dependencies:** Supabase `liqocisegeqzbyuqloql` schemas, Vault and account entitlements, `lounge-core-xtream`, `lounge-core-live-m3u`, `lounge-core-live-xmltv`, `lounge-core-sky-nz-epg`, `lounge-shared-epg-sync`, `tvnz-license-qa`, BEST provider bindings, Cloudflare domain worker and relevant scheduled jobs. The player repo `epg-data` head was frozen at `4df2d2ab90e8fb739fd68132553f1144a9d64a41` under `release/locked-epg-data-20261120`. **Keep the actively updated `epg-data` branch.**

**Cleanup facts:** 73 Edge Functions, 22 active scheduled jobs, 128 application tables, one private international EPG bucket, and no Supabase hosted dev branches observed on 20 November. The last 24-hour Edge logs showed 21 called functions, but inactivity alone does not justify deletion. See [Issue #17](https://github.com/Gazzamoo111/lounge-tv-feed/issues/17).

**Outstanding:** post-deploy physical Nuvio native Xtream guide import and protected playback, fresh customer acceptance, EPGenius paid-service permissions, private DB/secrets/Cloudflare backups. Do not claim full product acceptance. No data/table/cron/function deletion authorised solely by their age.
