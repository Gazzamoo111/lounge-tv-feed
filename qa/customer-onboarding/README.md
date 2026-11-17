# Lounge TV customer launch flow (QA, 18 Nov 2026)

## 24-hour trial
1. Customer requests a trial through WhatsApp.
2. Operator issues a real 24-hour BEST reseller trial, then privately sends individual credentials.
3. Customer installs Nuvio + IPTV, creates a Nuvio account, and imports the BEST trial under Settings > Live TV > Playlists.
4. Verify playback and guide. The trial expires in BEST. Do not purchase TorBox or promise premium movie/series access for a trial.

**Important:** The old Supabase trial functions return HTTP 410 and must not be used. The QA customer-token gateway currently requires an active subscription and service assignment, so it does not replace the BEST trial flow.

## Paid customer
1. Verify payment, subscription expiry, provider account and BEST assignment.
2. Run the existing admin-only activation script in check mode, then issue the revocable individual M3U link.
3. Customer installs Nuvio + IPTV, creates their own account, and imports the link as Lounge TV Live through a supported URL/QR route.
4. Verify Live TV + EPG. Customer enables Settings > Live TV > Nuvio Account Sync so their setup carries over to additional devices.
5. Add the premium experience only after the separate customer-specific AIOStreams, TorBox and Xperience components have been configured and verified. The existing paid activation script does not automate those components.

## Premium setup: minimum viable standard
- **Nuvio identity:** customer-owned, distinct from all operator profiles.
- **TorBox:** individual customer account and API key. Commercial partner/voucher/account issuance requires TorBox approval. Never reuse an operator API key for customers.
- **AIOStreams:** customer-specific verified configuration referencing that customer's TorBox key, approved stream add-ons, source preferences and size limits. Official User API supports creation and returns UUID and encrypted password for a private manifest. Do not invoke it on an instance without commercial permission.
- **Xperience:** use a dedicated, neutral Lounge TV profile for the Movies, Series and Family collections. Link the customer's authorised Nuvio account and use Push to Nuvio for the chosen profile. This distributes the Xperience add-on, collections and order. No bulk reseller account API has been established.
- **Metadata:** install only the approved catalogues/metadata. Hide duplicate source rows so the home screen is not flooded.
- **Badges:** install the approved Obsidian/Fusion badge JSON using Nuvio Settings > Layout > Fusion badge URLs > Import and Save. Badge settings syncing requires live-device testing.
- **Hero and ordering:** enable Show hero images. On TV set Reorder home catalogs to Follow addons order when Nuvio local overrides prevent the Xperience row order from showing. Recheck after restart.
- **Master:** use only a neutral Lounge TV Master Profile 2. Never clone Mum & Dad or kids viewing history, profiles, libraries, avatars, credentials or personal add-ons.

## Current automation boundaries
| Component | Status |
| --- | --- |
| BEST trial | Manual through reseller; existing old Supabase trial endpoints retired |
| Paid customer playlist | QA link issuance/revoke/check implemented; no fresh eligible paid service yet verified end-to-end |
| Nuvio sign-in | Customer-owned account |
| Live TV Setup Sync | One manual initial import; independent encrypted fork service |
| Xperience rows/collections | Manual authorised Link Nuvio and Push to Nuvio supported |
| Badges/hero settings | Supported in app; automatic customer sync not yet proven |
| AIOStreams manifest | User API exists; commercial instance and customer config not connected to Lounge TV |
| TorBox | Partner approval and customer issuance not verified; cannot be promised as automated |
| WhatsApp handoff | Script generates message; operator sends it |

## Launch gate
Use ONE completely new dummy customer account. Check separate identity, clean add-ons, populated Xperience folders, hero, Obsidian badges, a single working Live TV source, EPG, subscription expiry/revoke, app restart and second-device sync. Test paid TorBox + AIOStreams only with a separately authorised customer account/key.

Do not claim full automatic premium provisioning until that is proven. Leave production lounge-core-xtream v52, QA gateway n v33, Supabase Free tier and all personal profiles untouched. Never put customer credentials, tokens, manifest URLs or provider accounts in public GitHub.