# Lounge TV locked Xtream source | 20 November 2026 NZDT

This is a self-contained **source-code recovery snapshot**, not a public customer playlist. All deployed code copied exactly.

| Directory | Supabase function | Reference | Bundle SHA-256 | Entrypoint | verify_jwt |
|---|---|---|---|---|---|
| `n-v38/` | `n` | v38 ACTIVE | `c67dd009bd4089e3897d6921063c8608353293de8b39bc7450e84344a6a8637e` | index.ts | false |
| `n-v37-rollback/` | `n` | v37 prior live | `ea170d5bc88cb65cc58a46cd5172d352921c7f03eaa82a2b57f7f6ee62790e1c` | index.ts | false |
| `plus-v5/` | `lounge-plus-qa` | v5 ACTIVE | `9820504273ca9e5676fc30bcc9fbe7a6e11ecf6640e7e014db30381af37ee39b` | index.ts | false |

The n-v38 and Plus v5 directories are exact copies of the running Supabase function source. The n-v37 source uses the same 12 unchanged files as v38 plus the original `index.ts` and `plus-account-route.mjs` from reviewed commit `589ecddb085352585d3f7d3b6a65ecc2ad444b68`. Candidate PR #16 is pinned at `e4c758bb4c866c8ba8786681c105742ab48a3188`. Historic v36 is NOT the rollback because it drops Plus delegation.

Additional live dependencies NOT captured in these directories: production Supabase database rows/schema, Vault/secrets and environment bindings, subscriptions, Cloudflare Worker/domain `n.loungetv.nz`, `lounge-core-live-xmltv`, `lounge-shared-epg-sync`, TVNZ licence functions, `lounge-core-xtream`, relevant cron jobs, and the sibling player repo `epg-data` branch. The upstream epg66/epg64 guide files are external and are not backed up here.

Automated authenticated EPG comparisons passed and v38 source readback matched. Fresh Nuvio native Xtream guide autoload and post-deployment TVNZ/Sky actual playback remain unverified. EPGenius commercial distribution permissions not confirmed.

Rollback: restore the complete `n-v37-rollback/` directory to function `n` while preserving the existing production environmental configuration and Plus v5, then verify authenticated feeds, TVNZ and Sky Sport on device. This is a source recovery snapshot, not a demonstrated runtime rollback.

Do NOT delete this branch, the `epg-data` branch, serving functions, database, schedules or original v37 recovery reference during cleanup without independently verified dependencies and restore. Pin this snapshot commit SHA. GitHub branches are mutable. No credentials or customer data are intentionally included.
