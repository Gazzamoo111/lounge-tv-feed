# Lounge TV Xtream direct EPG QA

20 November 2026 NZDT. Tracking [Issue #10](https://github.com/Gazzamoo111/lounge-tv-feed/issues/10) and [Issue #6](https://github.com/Gazzamoo111/lounge-tv-feed/issues/6).

## Serving status

- The isolated Plus account QA function `lounge-xtream-direct-epg-qa` v3 is active. Source was read back byte for byte after deployment. Bundle SHA-256 `481932c45d2b2b524132b28383218509f8cc849fdb11dc55adc0ce3e6e4ae1cb`.
- `n.loungetv.nz` still serves `n` v37. The Plus delegation still serves `lounge-plus-qa` v5. The device-tested preview remains `lounge-direct-epg-device-qa` v2. Production release and DNS were outside this QA deployment.
- The native change is in [draft PR #16](https://github.com/Gazzamoo111/lounge-tv-feed/pull/16). It applies the pinned map in both the standard `n` M3U response and the delegated Plus response. It leaves the Xtream authentication and 503 handoff in place.
- The equivalent QA entry uses Add M3U and the isolated function's `/get.php` with the existing Plus username and password and `type=m3u_plus&output=ts`. Nuvio 1.2.0-beta.1.4 discards the path in a native Xtream server field. The existing host will work for native Xtream after a separately approved release. Do not paste account credentials into GitHub.

## Verification

- The versioned map matches the deployed device reference exactly. Each replacement requires both the stable channel ID and the original guide ID.
- The [authenticated comparison](https://github.com/Gazzamoo111/lounge-tv-player/actions/runs/44692490514) passed on v3. It recorded 13,380 rows, 967 mapping changes, literal ampersands fixed on 3,115 channel rows, and the original canonical guide URL followed by epg66 and epg64. Category IDs and ordering, media URLs and DRM lines matched the original. The previous preview origin had 5 identical media URLs and 13,375 equivalent media paths on its alternate host. This establishes routing parity. It leaves startup, buffering and device-side guide order to the final check.
- The protected suite passed 34 routing tests, 11 validators, three gateway profile replays and five guide projections including TVNZ 1/2 and Sky Sport 1–9. Fourteen QA and customer-link tests passed locally. The final Nuvio check should keep the proven guide configuration and confirm the candidate's category display and playback for the existing account.

## Rollback

Turn off or remove only the added QA source in Nuvio. The existing server and login can continue to be used immediately. The release rollback reference is [n v37](https://github.com/Gazzamoo111/lounge-tv-feed/tree/589ecddb085352585d3f7d3b6a65ecc2ad444b68/qa/lounge-plus-route) and its [restore manifest](https://github.com/Gazzamoo111/lounge-tv-feed/blob/720c010b6847d01228372aac1a1772feebb44444/ops/phase-1/release-manifest.json).
