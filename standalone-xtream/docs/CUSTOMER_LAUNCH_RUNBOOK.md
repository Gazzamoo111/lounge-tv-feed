# Lounge TV | Customer launch runbook (Cloudflare-only live TV)

**Status, 23 November 2026 NZDT.** The isolated Cloudflare production gateway is deployed at `https://tv.loungetv.nz`, version `8a90126d-709e-4f18-bd6c-1b631ac05bc4`, with the exact QA catalogue (`v20261123-deduplicated25-au9`) and XMLTV (`v20261123-issue22`). The permanent customer URL remains on the legacy Supabase-backed gateway pending acceptance. Current live evidence and rollback references are recorded in [ops/CURRENT_STATE.md](../../ops/CURRENT_STATE.md) and Issue #25.

## Customer contract and limits

A new customer enters **Xtream server URL + their own Lounge TV username + password** in a supported player such as Nuvio + IPTV. The Cloudflare Worker authenticates the Lounge TV line in D1, serves the approved 25-category catalogue and XMLTV from private R2, and redirects authorised playback to that customer's **own BEST provider line** using securely encrypted provider credentials. The five NZ Freeview overrides remain independently implemented in the Worker. Customers do not enter BEST reseller credentials.

**Critical limitation:** Xtream/M3U can deliver curated category contents, order, logos and EPG, but **cannot enforce Nuvio-local group visibility, channel order or Sports Hub options** on an unrelated fresh installation. Nuvio's Setup Sync is tied to each user's own Nuvio account; do not distribute or re-use the owner's sync account or secrets across customers. A true 'credentials only, complete app UI preset' experience requires a separately verified Nuvio import/preset feature or a controlled customised player build. Until then, onboard with **Group Order = Playlist Order**, **Channel Order = Playlist Order**, and hide **🏆 Live Sport | Events & PPV** from normal Live TV guide; on a real account verify that hidden 6,756-stream event pool remains available to Sports Hub. Do not remove event records from the delivered feed.

## Production architecture (recommended first launch)

**Isolated new-customer production hostname:** `tv.loungetv.nz` (live for isolated acceptance). This avoids hijacking existing `connect.loungetv.nz` customers. Use a distinct production Cloudflare Worker, **independent production D1** and separate **private production R2**, with separate authentication HMAC pepper, 32-byte AES-GCM provider key, bucket-scoped deployment credentials and rollback pointers. Do not bind production to QA's D1 or share QA secrets. The exact immutable QA catalogue and guide should be copied and verified by object hashes; never recreate or silently re-curate them.

The current Worker is **Live TV-only**, with no automatic BEST provisioning, VOD, payments, CRM, device activation, billing or automated renewal. It **reports** `max_connections` in Xtream account_info but does **not** enforce a live session count. Do not claim enforced connection limits. Test real BEST-side concurrency limits per entitlement before selling a one-connection product.

### Provider continuity gate: mandatory before any paying customer

The BEST account currently used in QA is a **trial expiring 24 November 2026**. Do not publish or rely on that trial for paying customers. Obtain a durable BEST line for the first production user, with the exact approved source-ID-compatible LoungeTV Premium bouquet (known trial export matches 13,187 of 13,292 BEST source IDs). Retain per-customer provider credentials and expiry. Create an additional distinct provider line for each paying customer instead of sharing the test or owner line; verify connection limits and customer isolation. Preserve the 105 previously identified missing UHD/Relax streams as known coverage exceptions without silently advertising them as working.

### Minimum safe first-customer flow

1. Verify payment/entitlement manually using the existing Lounge TV customer-and-renewals ledger.
2. From BEST reseller portal, provision a **unique provider line** for the customer, with approved bouquet and appropriate paid expiry; securely handle it. Never paste into GitHub, Work notes, public documents or support messages.
3. Issue a unique Lounge TV username and strong password. Use the existing `standalone-xtream/scripts/provision_account.mjs` **with stdin JSON and production secrets in a secure execution environment**, then apply its encrypted SQL to the **production** D1. Do not send any plaintext credential as a command-line argument. Production expiry should be at or before provider expiry.
4. Verify live Xtream login 200/active, category count 25, expected stream count 13,083, EPG endpoint and 2–3 real live channels. Test wrong-password denial, expiry and revocation against a non-customer test account.
5. Send customer **only their own** Xtream server URL, Lounge username/password and minimal Nuvio install/setup instructions. Explain one-time Guide group/channel order and hidden event pool if the app does not inherit those settings. Do not send upstream provider credentials or the owner/admin QA login.
6. On renewal, verify provider line is renewed first, then update D1 entitlement expiry and the renewals ledger. On cancellation/expiry, disable/revoke both the provider line and the D1 customer auth. A renewal that only updates D1 while BEST is expired will produce channels that look available but fail to play.
7. For support, keep records of account pseudonymous ID, plan, provider account reference, provider expiry, D1 expiry, successful activation and faults. Never store plaintext passwords in the ledger.

### Technical release acceptance

- [ ] Clone the verified QA source and **exact immutable R2 release** to independent production resources; record all SHAs, object counts, names, timestamps, domain bindings and rollback.
- [ ] Secure independent production Worker/D1/R2/secrets and custom hostname; keep production origin HTTPS and determine/accept the provider redirect's HTTP transport/security limitations. Avoid logging tokenized streaming paths.
- [ ] Confirm production `get.php` and `player_api.php` are interoperable with Nuvio; test a **clean Nuvio profile with no owner Setup Sync** and a uniquely provisioned production user. All customer-visible category ordering, logos and working EPG should be verified on that clean install.
- [ ] Verify hidden **🏆 Live Sport | Events & PPV** still supplies Sports Hub live event matching. If it does not, do not hide this category by stripping it from the backend until another working source mechanism is demonstrated.
- [ ] Confirm TVNZ 1/2 true Widevine playback grants on supported NZ Android TV, or label those channels unresolved rather than claiming success.
- [ ] Confirm one production BEST line and two simultaneous device sessions behave according to the sold plan. Worker currently **does not enforce** concurrent sessions.
- [ ] Enable and monitor scheduled Cloudflare-compatible EPG refresh: **the existing GitHub workflow is prepared but not running**; it requires credentials and a verified source-refresh success. Publish only genuine current/upcoming programmes; restore last good guide on failure. Record last successful refresh and monitor staleness.
- [ ] Test 24-hour activation/expiry/revocation/renewal behaviour and no-customer-cross-access using two independent test accounts/provider lines.
- [ ] Test playback of Sky Sport 1, BBC One, one AU and one US channel on a physical NZ device and an event via Sports Hub (do not block on specific upstream defects that user knowingly accepted). At least one long-form 10–30 minute uninterrupted test; record results.
- [ ] Independent production rollback: restore prior Worker/R2 pointer without touching `connect.loungetv.nz`, existing customer accounts or Supabase.
- [ ] Make onboarding/support copy truthful: credentials give the catalogue and EPG automatically; guide visibility/order settings remain one-time client-side actions unless specifically proven auto-applied.

## Rollout order

**Phase 1:** Publish only the new production hostname to 1–3 consenting new test users after durable BEST lines, refresh, provisioning and device checks. Keep legacy production untouched.

**Phase 2:** Open normal signups after successful activation, renewals and support tests. Start manually provisioned, recorded, per-customer lines before considering automated reseller provisioning.

**Phase 3:** Migrate existing `connect.loungetv.nz` users one by one with dual-running and rollback, only after the old Supabase-dependent website, billing, device activation and account paths have been fully inventoried. Do **not** retire Supabase merely because the Live TV gateway works.

### Hard stop / reversibility

Do not cut over `connect.loungetv.nz`, migrate any existing account, delete Supabase data, expose the provider trial as shared customers' line, or mark full 'credentials-only app configuration' complete without the mandatory checks above. Record actual Cloudflare deployment IDs and real playback evidence; CI and R2 object parity alone are not device acceptance.
