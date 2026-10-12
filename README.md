# Lounge TV Feed

Cloud-generated Lounge TV playlist, guide, and related feed assets.

## Catalogue status (verified 12 October 2026)

| Layer | Count | Meaning |
| --- | ---: | --- |
| Supabase `public.logical_channels` | 1,893 | Stable logical TV-channel identities (1,887 active) |
| Supabase `public.channel_sources` | 2,862 | Playback sources, including 1,893 primaries and 969 backups |
| BEST curated Android QA manifest | 7,737 | Approved numeric provider source IDs, **not** 7,737 live customer-facing channels |
| BEST full source register | 20,575 | Discovery/reference inventory, not a production playlist |

**Production and QA are not synchronised yet.** Do not represent the 7,737 QA
IDs as already imported to Supabase or published in this GitHub feed. Do not
confuse logical channels, playback sources, and visible browsing entries.

## Current feed pipeline

- `config/master_v5.json` controls the legacy GitHub catalogue selection.
- `scripts/update_feeds.py` generates `docs/lounge-clean.m3u` and
  `docs/epg6-live.xml` from upstream sources and that configuration.
- `.github/workflows/update-feeds.yml` runs every four hours.
- `docs/lounge-secure.m3u` is an older internal/backup representation,
  not the new BEST catalogue database.

This workflow does **not** automatically import newly approved BEST stream IDs
from the Android QA manifest into Supabase. Increasing a displayed count or
regenerating the existing playlist does not perform that migration.

## Required for the next production catalogue release

1. Match approved BEST numeric source IDs to existing `channel_sources`.
2. Preserve `logical_channels.id` and customers' saved-channel associations.
3. Keep backup, hidden, review and event-reserve sources out of ordinary browsing.
4. Reconcile duplicates, EPG mapping and provider metadata before publishing.
5. Verify which feed the installed Android/Fire TV app actually reads.
6. Release and verify the Supabase and GitHub catalogue updates separately.

**Never commit IPTV provider credentials, authenticated URLs, service-role
keys or private tokens to this public repository.**
