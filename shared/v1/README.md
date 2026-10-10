# Lounge TV unified content, Stage 10

**Development only. Not deployed to customers.**

The goal is a single curated Live, EPG, VOD and artwork service for both
Android / Fire TV and LG webOS. Playback remains platform-specific.

## Existing integrations

- Supabase remains the source of truth for devices, subscriptions, service
  assignments, access expiry and playback tickets.
- The existing Cloudflare live media gateway is not changed by this branch.
- Cloudflare R2 public `loungetv-artwork` continues serving image assets.
- The shared metadata content is loaded from a **separate private**
  `loungetv-content` R2 bucket. Never place credentials or provider URLs there.
- The new `lounge-tv-content-dev` Worker is **disabled by default**.

## API contract

GET /v1/health is public and returns service availability.

Authenticated requests require X-Device-Id and X-Device-Token headers, plus
an active subscription and service assignment:

- GET /v1/manifest
- GET /v1/catalogue
- GET /v1/vod
- GET /v1/epg

The Worker reads versioned JSON from private R2:
`shared/v1/releases/<revision>/{manifest,live,vod,epg}.json`.
`shared/v1/current.json` selects the active release.

These files contain metadata only, never raw upstream URLs, usernames,
passwords or video tokens. Playback still requires an authorised playback
ticket from the existing backend.

## Integration order

1. Confirm BEST reseller provisioning and commercial content rights.
2. Approve the curated channel catalogue instead of the 15,503-channel trial.
3. Create a private R2 content bucket and test device API with sandbox data.
4. Implement a validated publisher and rollback for revisioned JSON.
5. Adapt Android and LG clients to the same v1 data contract and shared R2 artwork.
6. Test LG while the Mac bridge is off; verify playback and expiry checks.
7. Only after testing, switch customer installations.

Keep Android 1.0.72 and working LG 0.11.8 untouched while staging.

No production changes, database changes, APK or IPK installation are included.

## First isolated upload using Wrangler OAuth

From the repository root after `git pull --ff-only`:

```bash
python3 shared/v1/publish.py shared/v1/examples/release.json \
  --out "$HOME/Projects/LoungeTV-Stage10-Demo-Output" \
  --publish --confirm-authorised --wrangler
```

This uses the Cloudflare Wrangler OAuth session, not the separate rclone
credentials for the public artwork bucket. It writes four versioned demo
JSON files to private `loungetv-content`, verifies the uploads by downloading
and hashing them, and updates the private staging `current.json` pointer only
after verifying the four files. The Worker keeps `CONTENT_ENABLED=false`
until a deliberate, separately reviewed activation. Reruns with the same
local output path stop rather than overwrite the existing local release.

The demonstration programme and film names are fictional. Do not upload real
supplier playlists or customer data through this test command.
