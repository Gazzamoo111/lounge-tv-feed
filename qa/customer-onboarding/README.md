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

## Restore the 41-folder Xperience layout without personal account data

1. Create a new clean Xperience profile to obtain its own addon ID (the `app.xperience.<uuid>` value).
2. Generate a fresh collections import locally using `node scripts/customer-onboarding/build-xperience-import.mjs app.xperience.<NEW_UUID> > collections.json`.
3. Import the generated collections JSON into **only** that clean Xperience/Nuvio profile. Keep the new IDs, public artwork and source mappings; do not merge this into Mum & Dad.
4. Export the resulting NEW manifest JSON and run `node scripts/customer-onboarding/validate-xperience.mjs manifest.json`. Do not push until all 223 catalogue mappings are present; then visually confirm the collections populate and artwork is visible on a real Fire TV.
5. Use Xperience's Link Nuvio and Push to Nuvio on the explicitly authorised customer account, then check badge import and hero settings separately.

Offline QA: generated 3 collections, 41 unique folders, 223 remapped source entries and 123 public CDN artwork URLs, with no original personal addon ID. The generator rejected an invalid new addon ID. The manifest validator passed 223/223 on a synthetic complete manifest and failed correctly with two catalogue mappings removed. **These checks do not prove the fresh Xperience account, device import or live TorBox playback.**


## Xperience Import: preferred live path (18 November 2026)

**Use Xperience's supported Profiles > Import config workflow first.** The user-provided Nuvio collections.json contains 3 collections, 41 folders, 223 catalogue references and 123 Xperience CDN artworks, with no TorBox/API credentials. Import it into a **new neutral Xperience profile**, rather than copying the Mum & Dad Nuvio account.

1. Sign in to the dedicated Xperience account, then Profiles > Import config > Nuvio collections.json. Check that it creates a new profile (not an overwrite of the personal profile).
2. On the imported profile, verify separately owned MDBList and TMDB credentials and check that all 223 catalogue identifiers resolve to the **new** Xperience install manifest. The original file references a personal Xperience addon ID: verify imported sources are remapped; do not assume the import does it automatically.
3. Set home rows with new releases/trending prominent, and collections Streaming, Genres and Studios. The collections export alone does not include the complete home rows or TV hero settings.
4. Link only the isolated Nuvio test identity and target its clean profile via Finalize > Push to Nuvio. Inspect all rows and streams after restart. Check badge pack, hero toggles and "Follow addons order" separately.

**Hard commercial boundary:** Xperience's guide says install links are for an individual/household and multi-location use may trigger a pause/reset. Reuse the **collection layout as a template**, not the same hosted profile manifest across unrelated customer accounts. Obtain explicit commercial authorisation or design an authorised individual-profile provisioning solution before selling it as shared/managed access. Likewise TorBox account resale requires written permission.

**Existing cloner risk:** At latest read, the source displayed a personal profile with multiple provider manifests and a TorBox key in the URL; the test target indicated 10 addons copied. Do NOT use this target as the clean master until inspected/cleared. Never reuse the old copied personal TorBox key; rotate it and replace its private integrations only after verifying the impact on the operator's devices.

The earlier build-xperience-import.mjs is an **offline alternative for an already-created new neutral Xperience addon ID**. Do not use it as the primary route or claim it has been imported/tested on a device.
