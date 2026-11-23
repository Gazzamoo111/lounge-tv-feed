# Supabase retirement audit | Lounge TV | 23 November 2026 NZDT

## Decision

**Retire the old Supabase-backed Lounge TV stack after transferring the owner's account to a durable standalone Cloudflare production service and checking for surviving customer dependencies. Do NOT delete Supabase yet.** Existing production `connect.loungetv.nz` still routes through old Supabase. Working Cloudflare QA is separate and its BEST trial expires 24 November 2026; its QA login expires 30 November. Neither is durable paid production. Related: [customer launch Issue #25](https://github.com/Gazzamoo111/lounge-tv-feed/issues/25), [launch runbook](../standalone-xtream/docs/CUSTOMER_LAUNCH_RUNBOOK.md).

## Verified live Supabase read-only snapshot

Project `liqocisegeqzbyuqloql`, region `ap-southeast-2`, status ACTIVE_HEALTHY. Data gathered read-only from Supabase project API and SQL on 23 Nov 2026.

| Area | Observed state |
| --- | --- |
| PostgreSQL database | **445 MB** |
| Application tables | **106** in schemas public (48), lounge_core (35), lounge_delivery (13), lounge_sync (10) |
| Scheduled jobs | **22**, of which **14 active** and 8 already inactive |
| Cron executions in previous 24 h | **1,705 successes**, 0 failures |
| Customer profiles | **8** |
| Subscriptions | **7**: 6 expired, 1 labelled active despite current_period_end **2026-11-05 22:30:11 UTC** (already past) |
| Service assignments | **7**: 6 expired, 1 labelled active with expires_at **2026-11-05 22:30:11 UTC** |
| Provider accounts | **10** BEST: 7 expired, 3 marked assigned, the latter with outdated or null expiry; panel confirmation needed |
| Device records | **42** |
| Activation codes | **87** |
| EPG storage bucket | One private bucket `lounge-international-epg-qa` |
| Legacy consumers | `connect.loungetv.nz` proxy, Supabase Edge Functions `n`, `lounge-core-xtream`, old provisioning, legacy website/admin and any other remaining integrations, before investigation |

### Scheduled jobs to retire at the **verified** cutover

Business-critical until replacement proved:
- 4 lounge-prepaid-expiry-enforcement (active)
- 5 lounge-activation-notice-retries (active)
- 6 lounge-trial-expiry-followup (active)
- 7 lounge-operational-health-snapshot (active)
- 8 lounge-admin-new-request-alerts (active)

Provider/data processing potentially obsolete in new Cloudflare model (but **could still feed legacy services until cutover**):
- 15 lounge-core-live-source-refresh (active)
- 19 lounge-best-provider-poll-hourly (active)
- 20 lounge-best-provider-collect (active)
- 21 lounge-best-inventory-import (active)
- 22 lounge-best-categories-refresh (active)
- 27 lounge-best-247-sync (active)
- 29 lounge-sports-event-refresh-v3 (active)
- 30 lounge-shared-epg-database-sync (active)
- 33 lounge-cron-log-retention-3d (active)

Already inactive (no immediate schedule savings): 12, 13, 14, 17, 18, 23, 24, 26.

Supabase table inventory also surfaced **36 tables without RLS enabled**, including `lounge_core` tables; verify Data API schema grants before interpreting public exposure. Security advisory warns that tables without RLS can be accessed by granted client roles. **Do not mass-enable RLS without evaluating existing policies/consumers**. Official docs: https://supabase.com/docs/guides/database/postgres/row-level-security

## Execute in this order

1. **Secure production tenancy in Cloudflare** on a separate hostname (proposed `tv.loungetv.nz`) and independent D1/R2/Worker secrets. Verify hashes for the approved `v20261123-deduplicated25-au9` curated catalogue: **25 categories, 13,083 stream entries, 6,756 untouched PPV event streams**, plus correct EPG. Preserve rollback.
2. **Bind a renewable paid BEST line to owner's Cloudflare production account**, with dedicated provider credentials encrypted in production D1. Do not reuse the expiring QA trial for a public account. Use `standalone-xtream/scripts/provision_account.mjs` from secure stdin. Verify real Nuvio Xtream import, Sports Hub event matching (hidden PPV group) and one long Sky Sport playback.
3. **Establish permanent account/renewal ops**: D1 expiry, provider paid expiry, provider connection limits, manual enrolment and renewal record outside Supabase, revoke on cancellation. Currently Worker only *reports* max_connections; does not enforce it. Activate monitored EPG refresh, which is presently prepared but not scheduled.
4. **Audit remaining Supabase dependants** before shutting it down: existing `connect.loungetv.nz`, any subscriptions that look active, live devices, public websites, `admin.loungetv.nz`, trial creation/activation/notifications, monitoring, EPG automation, player credentials or login backends. For any customer still paying, migrate or explicitly end that service, and retain required billing records. Never silently strand third-party customers.
5. **Archive** required customer and accounting records and site/admin config into a verified, private secure destination. Do not commit credentials, plaintext access tokens, customer PII or full provider M3U to public GitHub. Preserve a time-limited encrypted rollback copy until migration has been verified and required retention addressed.
6. **Dual-run and test** production Cloudflare account and renewal at least 24 hours. Verify no old Supabase API requests are necessary for playback, provisioning, guide, renewals, administration, payments or websites. Measure request and cron activity before shutdown; demonstrate a working production rollback.
7. **Stop redundant Supabase cron jobs**, initially the old media ingestion group (15,19,20,21,22,27,29,30) only once proven unconsumed, then legacy notifications/expiry/monitoring (4–8) after successor processes verified, then cleanup job 33. Re-query `cron.job` to confirm no active jobs. This step is a stateful mutation and must NOT run earlier.
8. **Retire Supabase functions/storage/tables after a verified dependency-free window**; only then decide whether the **entire Lounge TV Supabase project** can be deleted. Project deletion removes database, storage, auth and backups and is irreversible without a separate backup. Check other app/site integrations before final project deletion; no assumption of zero dependencies solely from lack of direct viewing.

## Hard release gates

- [ ] New Cloudflare production hostname resolves and 25-category QA release fully imported without changing visual metadata or PPV.
- [ ] Owner's durable provider line paid/renewable and provisioned, account access and expiry tested.
- [ ] New Nuvio client outside owner's QA setup works; EPG refresh active and monitored.
- [ ] Old production customers and admin/website workflows reconciled or deliberately retired, not accidentally broken.
- [ ] Private backup verified, and no outstanding financial/account retention obligations ignored.
- [ ] Supabase active jobs can be paused without observable impact.
- [ ] Supabase project and associated resources then safely deleted.

**No Supabase mutation or project deletion has been executed at the time of this audit.**
