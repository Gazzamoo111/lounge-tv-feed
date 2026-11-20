# Lounge TV Xtream direct EPG QA

20 November 2026 NZDT. Tracking [Issue #10](https://github.com/Gazzamoo111/lounge-tv-feed/issues/10) and [Issue #6](https://github.com/Gazzamoo111/lounge-tv-feed/issues/6).

## Production release: 20 November 2026 NZDT

- **Production n v38 is ACTIVE** at the existing Supabase function `n`, deployed following explicit owner approval to apply PR #16 at `n.loungetv.nz`. New package SHA-256: `c67dd009bd4089e3897d6921063c8608353293de8b39bc7450e84344a6a8637e`. The direct-EPG patch source is PR #16 head `e4c758bb4c866c8ba8786681c105742ab48a3188`.
- Deployment readback confirmed all 16 source files: the two modified files matched PR #16 exactly; the two added files matched PR #16 exactly; all 12 unaffected files matched the previously deployed v37 source byte for byte. `verify_jwt=false` was preserved. The 967 guarded mappings and canonical, epg66, epg64 ordering are included.
- Existing Plus `lounge-plus-qa` v5 was **not redeployed**; `n` v38 transforms the delegated Plus M3U fallback response. Authentication, Sky routing and TVNZ licence paths were not intentionally changed.
- **Rollback:** redeploy the original 14-file `n` v37 source pinned at `589ecddb085352585d3f7d3b6a65ecc2ad444b68` with the same Edge settings; the previous bundle SHA-256 was `ea170d5bc88cb65cc58a46cd5172d352921c7f03eaa82a2b57f7f6ee62790e1c`. This is a source recovery reference, not a claim that a runtime rollback was rehearsed.
- **Not yet verified:** public custom-domain HTTP request after deployment (external DNS access unavailable to operator runtime), Nuvio native Xtream login guide auto-loading, physical TVNZ/Sky/international playback, and fresh customer setup. The approved deployment proceeded despite older Phase 3/4 staging and rollback gates being incomplete. Commercial permission to bundle EPGenius URLs in a paid service remains unconfirmed. Do not claim device or broader launch acceptance.
- PR #16 was deployed directly from its reviewed candidate code and remains a draft GitHub PR until separately merged. Do not overwrite v38 with the older draft base.

---

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
