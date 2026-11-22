# Supabase retirement gates | read-only inventory 23 November 2026

The existing Supabase project remains ACTIVE and must not be deleted before migration.

Read-only inventory included 8 customer profiles, 7 subscriptions, 42 devices, 87 activation codes, 10 provider account secret records, 7 assignments, 7 provisioning jobs, 20,579 curator channels, and 4,465 playback events. Live Edge Functions include n v39, lounge-plus-qa v8, and lounge-core-xtream v52.

The current connect.loungetv.nz Cloudflare Worker forwards to Supabase's lounge-core-xtream. Other app, monitoring and provisioning services still depend on the old project.

## Release gates

- [ ] R2, D1 and Worker QA created and provisioned with real customer-specific source credentials.
- [ ] Nuvio authenticates via Xtream and imports all 37 categories and 14,717 channels.
- [ ] XMLTV programme ID alignment and short EPG verified on Nuvio.
- [ ] NZ/AU/UK/US test playback accepted; Sky Sport 1 plays for at least 10 minutes.
- [ ] Customer creation, expiry, revocation and renewal tested.
- [ ] Provider bouquet coverage and account connection limits validated.
- [ ] Auto EPG refresh and immutable R2 release rollback exercised.
- [ ] Existing account, activation, provisioning, financial and website dependencies migrated.
- [ ] Cutover to connect.loungetv.nz supervised with exact rollback retained.
- [ ] Supabase data exported and no active consumers depend on its functions.
- [ ] Only then retire Supabase.

First QA Worker is LIVE TV only. It does not replace automated BEST provisioning, VOD, payments, CRM, active connection-limit enforcement, legacy device activation or account sync. All production services remain unchanged.
