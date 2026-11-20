# Lounge TV customer-specific playlist links (QA only)

Status: deployed as `lounge-customer-playlist-qa`. The existing `n` gateway,
BEST account provisioning, Nuvio app, and production customer onboarding remain unchanged.

## Admin issuance
An authenticated Supabase admin (listed in `public.admin_users`) sends:

`POST /functions/v1/lounge-customer-playlist-qa/admin/issue`

Headers: `Authorization: Bearer <admin_supabase_access_token>` and `Content-Type: application/json`

Body:
```json
{"service_assignment_id":"<active-service-assignment-uuid>","label":"Lounge TV","expires_in_days":365}
```
The response contains `link_id`, `url`, and `expires_at`. The URL contains a random
32-byte bearer token, shown only once. **Never paste customer tokens in public issues,
analytics, logs, or source code.** Store the returned `link_id` for future revocation.

The issue handler checks the active service and subscription, its matching assigned
BEST provider account, and the account's Vault credentials. The token has an independent maximum lifetime of 365 days. Access is checked against the
CURRENT subscription, service expiry and assigned BEST account on every request,
so ordinary renewal of the same service assignment does not require reinstalling the playlist.

Preflight before issuing a link:

`POST /functions/v1/lounge-customer-playlist-qa/admin/check`
```json
{"service_assignment_id":"<active-service-assignment-uuid>"}
```
The response contains `ready` and, when blocked, a non-secret reason.

`POST /functions/v1/lounge-customer-playlist-qa/admin/list`
```json
{"service_assignment_id":"<active-service-assignment-uuid>"}
```

`POST /functions/v1/lounge-customer-playlist-qa/admin/revoke`
```json
{"link_id":"<link-id-returned-at-issuance>"}
```

## Customer installation

The recipient imports the `url` as an **M3U source** in Nuvio + IPTV and labels
it `Lounge TV Live`. It contains the integrated New Zealand category, including
TVNZ 1 and TVNZ 2, plus the existing BEST channels. The recipient's BEST credentials
are not present in the playlist or its channel URLs. TVNZ licence requests go
through a token-checked relay.

The BEST Xtream login remains a **separate source** for movies and series if needed.
This is a QA mechanism, not automated onboarding through a single Xtream login.

## Access boundaries and operational limits

- The link is a password-equivalent bearer secret, not a non-sensitive public URL.
- Access is checked on every playlist, guide, licence, and new channel request.
- Revocation stops new requests. Already-opened streams or externally cached
  BEST source URLs may keep playing until their existing connection ends.
- BEST's underlying provider may issue redirects to URLs containing **that customer's
  own BEST username/password**. A token hides these from the playlist, but does
  **not** eliminate credentials from the final media redirect. Solving that would
  require an independently assessed delivery/auth integration or a costly video
  proxy. Never put a shared reseller/master credential in this path.
- Nuvio's free-to-air direct stream links remain publicly accessible upstream.
  The token protects our playlist and TVNZ licence route, not public third-party URLs.
- Expired/stale subscriptions fail closed even when the database status says `active`.
- Renewals work with the same playlist link only when the service assignment ID is retained.
  A new service assignment ID or expiry of the link itself requires a new token.
- This function proxies **only guide and licence data**. It redirects video; it does
  not relay video bandwidth through Supabase.
- Do not distribute until a *fresh active customer* has completed a full-device test
  and any required content redistribution rights are confirmed.

## QA validation

- `qa/customer-playlist-link-core.test.mjs`: M3U credentials are stripped, TVNZ
  licence metadata is preserved, and unknown sources are rejected.
- `QA Customer Link Endpoint Smoke Test`: invalid tokens and unauthenticated admin
  calls return HTTP 401.
- Database access: hashed tokens only, private `lounge_delivery` table, RLS enabled,
  no anonymous/authenticated table permissions.

Rollback: stop issuing links and revoke existing QA link IDs. The source BEST and TVNZ
playlists are unaffected.