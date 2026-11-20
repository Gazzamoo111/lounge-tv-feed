# Lounge TV | Current Xtream Gateway

**Current reference: 20 November 2026.** The operating Live TV gateway is Supabase `n` **v38** at `n.loungetv.nz`, with account-scoped Plus delegation to `lounge-plus-qa` **v5**. This is the supported Xtream login for Nuvio + IPTV. Internal DRM-aware M3U fallback is not a customer setup step.

## Active implementation

- [`production/n/`](production/n/) stores the 16 files of the byte-verified v38 Edge Function.
- [`production/plus/`](production/plus/) stores the 15 files of the byte-verified Plus v5 Edge Function.
- [`production/release-lock.json`](production/release-lock.json) pins the exact source blob hashes, function versions, deployed bundle hashes, EPG configuration and rollback reference.
- [`ops/CURRENT_STATE.md`](ops/CURRENT_STATE.md) records the verified running version, dependencies and remaining checks.
- [`release/locked-xtream-20261120`](https://github.com/Gazzamoo111/lounge-tv-feed/tree/release/locked-xtream-20261120) contains the separately protected v38, v37 rollback and Plus v5 source snapshot.

**EPG:** Lounge TV canonical guide first, epg66 second, epg64 third; 967 guarded EPG remappings. Changes in v38 preserve category IDs/order, stream IDs and routing, TVNZ Widevine, Sky Sport choices, and Plus authentication. Old format `&amp;` in category labels is corrected in the emitted fallback.

**What remains unverified:** physical Nuvio playback/guide auto-import after the v38 production release; fresh customer acceptance; commercial permissions for EPGenius sources. Do not infer playback from ACTIVE metadata or automated feed tests.

## Operational guardrails

The GitHub repository is **public**. Never commit BEST credentials, private playlist links, API secrets, Supabase Vault contents, customer data or DRM keys. This source snapshot does not back up the live database, Cloudflare routing or secrets. Preserve these until separate private backups and end-to-end recovery evidence exist.

Do not delete `n`, `lounge-plus-qa`, `lounge-core-live-xmltv`, `lounge-shared-epg-sync`, `tvnz-license-qa`, `lounge-core-xtream`, source-dependent cron jobs or the player repo's active `epg-data` branch. Function names containing `-qa` are not proof of irrelevance. The historical v36 rollback removes Plus routing. Use the frozen **v37** source instead.

Historical October feed scripts and static `docs/` guide assets remain for compatibility and possible external consumers, not as the authoritative source of the v38 Xtream gateway. The hourly `refresh-fast-epg` workflow is intentionally unchanged until those consumers are assessed. See [cleanup Issue #17](https://github.com/Gazzamoo111/lounge-tv-feed/issues/17) for disposition of obsolete branches and infrastructure.
