# Lounge TV Universal Catalogue Gateway

Staging-only universal customer delivery layer.

## What this branch does

- Reuses existing Lounge customer/subscription/provider assignment tables.
- Reuses existing `lounge_core` canonical Live/VOD/source tables.
- Adds a versioned release snapshot so BEST sync cannot change customer admission.
- Exposes Lounge credentials only.
- Provides Xtream-compatible catalogue endpoints:
  - `/player_api.php`
  - `/get.php`
  - `/xmltv.php`
- Provides paginated Lounge-native endpoint:
  - `/api/v1/catalogue`
- Proxies playback server-side so BEST host/user/password remain hidden.
- Supports Live, Movies and Series episode playback.
- HOLD/DROP titles are excluded because only released items are addressable.

## Android

The Lounge Android app already contains an Xtream client. Pointing that client at this gateway is sufficient for catalogue ingestion. No new catalogue engine is required.

## Required Worker secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not commit provider credentials or Supabase service-role keys.

## Release key

Staging Worker variable:

`CATALOGUE_RELEASE_KEY=lounge-universal-staging-v1`

The release must exist in `public.lounge_catalogue_releases` with status `staging` before authentication succeeds.

## Security boundary

The client receives Lounge metadata and Lounge playback URLs only.

The client must never receive:
- provider hostname
- BEST username/password
- source health tables
- hidden backup identities
- provider category IDs
- raw provider source URLs

## Current status

Code only. Nothing deployed. No production database migration applied. No customer traffic changed.

The remaining activation step is to populate the staging release with the exact locked Live v3 and VOD v1 membership, apply the migration to a staging database context, set QA credentials, then deploy only the staging Worker.
