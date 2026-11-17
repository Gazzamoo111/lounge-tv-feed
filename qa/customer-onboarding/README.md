# Customer activation for Lounge TV, Issue 6

STATUS: QA staging only. A repeatable activation command is implemented. No live customer link can be issued until a new approved, current BEST service assignment exists. Public publication requires a clean first run.

## One activation step after approved sale

The existing payment process must mark the subscription and service assignment active, with a future paid-through date, and map the service assignment to its specific BEST provider account with stored Vault credentials.

Run locally with Node 20+ and environment variables LOUNGE_ADMIN_ACCESS_TOKEN (authenticated Supabase admin session JWT), LOUNGE_SERVICE_ASSIGNMENT_ID (service UUID). Optional: LOUNGE_CUSTOMER_LABEL and LOUNGE_LINK_DAYS (1-365; default 365).

- Read-only preflight: node scripts/customer-onboarding/activate.mjs --check
- Issue and generate one welcome message: node scripts/customer-onboarding/activate.mjs

Never run in public CI, use shell arguments for secret values, or publish the generated bearer link. Store the returned link ID securely for admin revocation. The output is the ready-to-send private message; it is not sent automatically via WhatsApp.

The link stays usable across normal PAID renewal of the SAME service assignment ID because every playlist/EPG/licence/stream request checks the current entitlement and current assigned BEST account. Revoking or expiring the service denies subsequent requests. Existing playing provider streams may remain open until their connection ends. A NEW service assignment ID needs a new link. Tokens expire independently after at most 365 days.

As of 17 November 2026 the 7 recorded services are expired by date; the one service that still says active expired November 5. Do NOT extend a historic customer record or falsely grant paid access to pass QA.

## Master and sync limitations

The JSON specification here is a no-credentials design contract, not a created Nuvio account, deployed Xperience template, or existing customer login.

Create a dedicated neutral Lounge TV Master identity and configure its add-ons and Xperience catalogues independently; only use Mum & Dad and The Boys as visual references. Do not copy their avatar, history, library, watch-progress, add-on URLs, or TorBox API key.

Account Manager can clone/manage add-ons/plugins and build collections on an account the operator is authorized to manage. Add-on/plugin push can fully replace. Collection import/clone merges by ID and may retain unrelated rows. Device-local settings are not reliably copied by that tool. Nuvio Cloud APIs document profile and home settings blob endpoints. Its current Android code includes ProfileSettingsSyncService syncing layout settings plus StreamBadgeSettingsDataStore, and HomeCatalogSettingsSyncService for catalog ordering. Therefore those categories are technically sync-capable. The external Account Manager tool used for the failed clone does NOT transfer them. A future customer-authorised push of a sanitised MASTER settings blob is a plausible integration, but requires a real clean master export, Nuvio user authorization and verification against the deployed Nuvio + IPTV build. Never market automatic complete home restoration as proven today.

Nuvio + IPTV Setup Sync is separately encrypted and owned by the logged-in Nuvio user. It syncs their own playlists and guide between devices once enabled. We have no authenticated third-party admin write endpoint to automatically push a Lounge TV M3U into another customer's Setup Sync account. The customer adds the single private M3U once and enables sync. TorBox needs its own customer account/key; do not supply shared TorBox keys.

## Nuvio personal playlist cleanup

No remote authenticated Nuvio device/account-control session is available here. Do not claim deletion. Identify exact source labels in the installed Nuvio app; preserve approved Live TV source and personal profiles. Remove retired sources, sync the cleaned Live TV setup, then confirm they stay removed on a second device. Do NOT use Delete Saved Setup without intending to erase the entire sync backup. Do not delete source BEST accounts, customer history or production gateways.

## Release gate

One fresh customer identity with a real active BEST service must show clean profiles, correct collections, home order, badges and hero settings, Live TV, EPG, renewal, expiry and revoke, plus second-device Setup Sync. Record only unavoidable setup steps, then update public website instructions. Production lounge-core-xtream v52 remains unchanged. Supabase Free only; never proxy video bandwidth.
