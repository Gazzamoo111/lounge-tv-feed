# Supabase retirement gates | read-only inventory 23 November 2026

The existing Supabase project remains ACTIVE and must not be deleted before migration.

Read-only inventory included 8 customer profiles, 7 subscriptions, 42 devices, 87 activation codes, 10 provider account secret records, 7 assignments, 7 provisioning jobs, 20,579 curator channels, and 4,465 playback events. Live Edge Functions include n v39, lounge-plus-qa v8, and lounge-core-xtream v52.

The current connect.loungetv.nz Cloudflare Worker forwards to Supabase's lounge-core-xtream. Other app, monitoring and provisioning services still depend on the old project.

## Release gates

- [x] Private R2, D1, Worker and isolated QA hostname deployed.
- [x] Public HTTPS verification covers 14,717 streams, 37 categories, full XMLTV, short EPG, M3U and account expiry/revocation.
- [ ] Provision a verified HTTPS BEST line in the dedicated QA account and verify access to the approved stream IDs.
- [ ] Nuvio authenticates via Xtream and imports all 37 categories and 14,717 channels.
- [ ] XMLTV programme ID alignment and short EPG verified on Nuvio.
- [ ] NZ/AU/UK/US test playback accepted; Sky Sport 1 plays for at least 10 minutes.
- [ ] Customer creation, expiry, revocation and renewal tested.
- [ ] Provider bouquet coverage and account connection limits validated.
- [x] Conditional QA R2 pointer switch and restoration exercised over HTTPS.
- [ ] Activate and verify scheduled refresh from live upstream guide sources.
- [ ] Existing account, activation, provisioning, financial and website dependencies migrated.
- [ ] Cutover to connect.loungetv.nz supervised with exact rollback retained.
- [ ] Supabase data exported and no active consumers depend on its functions.
- [ ] Only then retire Supabase.

First QA Worker is LIVE TV only. It does not replace automated BEST provisioning, VOD, payments, CRM, active connection-limit enforcement, legacy device activation or account sync. All production services remain unchanged.
