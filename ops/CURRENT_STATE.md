## Sky Sport NZ playback incident | 22 November 2026 NZDT

Owner reports Sky Sport NZ 1–9 stop after approximately 30 seconds. This supersedes the 21 November acceptance for those channels. [Issue #20](https://github.com/Gazzamoo111/lounge-tv-feed/issues/20) is open. Standard gateway remains **n v39**. Deployed entrypoints match main, and Sky live returns a BEST redirect. [Draft PR #21](https://github.com/Gazzamoo111/lounge-tv-feed/pull/21) head `55b4347` fixes HD backup ordering and scopes HLS opt-in to Sky Sport NZ. Handler fixtures and [CI](https://github.com/Gazzamoo111/lounge-tv-feed/actions/runs/44920978868) passed. That PR remains undeployed. Authenticated BEST duration, concurrent sessions and 10-minute Nuvio acceptance remain pending.

A separate owner-only Supabase M3U, `lounge-sky-rugby-qa` v1, was deployed for on-device comparison. It uses the existing Plus account verifier with a single Vault read and direct BEST playback. Source is pinned at `bbc0d082e7194b3fc6d7aae658b9e8e8af487728`. Local fixtures passed and the running endpoint rejected missing and invalid credentials. Production n v39 / Plus v6 were untouched. Authenticated Nuvio playback and the 10-minute acceptance test are pending. Remove the standalone QA function to withdraw the test feed.

Owner reports pauses approximately every 20 seconds and requested the fix on the existing Xtream login. Deployed **Plus v7** (bundle `bee6ef02ac3ac362e7c4561ccec045e35f348ef2d1e8a7828accb28f62845685`) as an owner-only playback trial. It redirects the same Sky Sport 2–8 live IDs from the known regional/FHD routes to distinct BEST HD TS sources after checking the existing Plus verifier. Sky Sport 1/9 remain on their existing HD sources. Non-owner, other channels, playlist and guide behaviour retain their v6 routes. Standard `n` stays v39. Handler isolation checks passed and all 16 deployed files matched readback. No sustained playback is confirmed. Reopen the channel without refreshing. Rollback is the [Plus v6 bundle source](https://github.com/Gazzamoo111/lounge-tv-feed/tree/2d729001115c04fb3402f31359696bb164f8d81a/production/plus). Trial source `12f59a0d5ba505b30ea9de03a6bc703a286199c4`.

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
