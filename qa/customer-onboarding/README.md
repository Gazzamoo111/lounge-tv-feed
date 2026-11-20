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
- **Badges:** install the approved customer's current custom Fusion badge JSON (7 groups; 31 enabled badges; 1 disabled) using Nuvio Settings > Layout > Fusion badge URLs > Import and Save. Badge settings syncing requires live-device testing.
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
Use ONE completely new dummy customer account. Check separate identity, clean add-ons, populated Xperience folders, hero, custom Fusion badges, a single working Live TV source, EPG, subscription expiry/revoke, app restart and second-device sync. Test paid TorBox + AIOStreams only with a separately authorised customer account/key.

Do not claim full automatic premium provisioning until that is proven. Leave production lounge-core-xtream v52, QA gateway n v33, Supabase Free tier and all personal profiles untouched. Never put customer credentials, tokens, manifest URLs or provider accounts in public GitHub.

## Corrected Xperience plan: stop rebuilding the working profile

**18 Nov 2026 correction:** The recommended path of manually importing the 41-folder collections export into a blank Xperience profile is superseded. It omitted all existing home rows, settings and required keys, and wasted effort.

1. On Xperience Profiles, use the menu for the existing **Nuvio Main Setup** profile > **Duplicate**. Xperience's official guide says a profile is a complete setup including rows, collections, keys and install link, and Duplicate copies an existing profile. Preserve its **actual** home order. Do not invent or reorder rows.
2. The separate newly created `Lounge TV Master` from a collections-only import is incomplete (0 home rows). If the user is on Xperience Free (3-profile cap) and the new third profile blocks duplication, **delete only that incomplete profile** first after checking its exact name. Never delete or edit Nuvio Main Setup or the kids profile.
3. Name the duplicate `Lounge TV Master`. Inspect its **10 existing home rows**, all **3 collections**, folder covers and order, existing required keys and profile preferences. Compare to the original. Never share or push it without removing personal trackers, watchlists, history, service account links and any private credentials the duplicate may have inherited.
4. **Do not push to an unrelated customer Nuvio account** at this stage. Xperience's current documented install links are for personal/household use. Obtain explicit permission for any commercial multi-customer distribution and provision isolated customer identities/configurations.
5. A customer-specific clone/push currently needs authorised account linking and a manual Xperience action; no supported bulk provisioning API has been verified. **Never advertise automatic onboarding until that integration is proved end-to-end.** For zero-touch commercial onboarding, investigate an authorised provisioning integration or replace the Xperience-hosted dependency with a controlled catalogue service. Avoid asking operators to rebuild rows per sale.
6. Continue BEST Live TV customer activation separately (private M3U + one customer import), and TorBox/AIOStreams only with permitted individual accounts.

The earlier 41-folder sanitised JSON and the offline generator/validator remain **QA reference or fallback**, not the preferred onboarding route. Do not delete them, but do not instruct operators to rebuild an existing complete profile from partial collections.


## Preconfigured Fire TV Stick 4K Max: customer handover acceptance gate (18 Nov 2026)

**Product target:** One physical Fire TV Stick 4K Max (2nd gen), configured for an isolated demo customer, couriered or moved to a second household, with no manual catalogue building by that household. Do not reset or alter the operator's working personal Fire TV.

**Apps visible in Projectivy:** Nuvio + IPTV and TizenTube only. Projectivy is the launcher; Downloader and support tools remain installed but hidden. No unnecessary apps.

**Verified platform capabilities (not yet proof of our handover):**
- Xperience can duplicate a complete existing profile and push its rows/collections into the target customer's chosen Nuvio profile; use a clean duplicate, preserve the original 10-row order, 3 collections and 41 folders, then remove personal trackers and inherited credentials. A collections-only JSON is not a full profile.
- The Nuvio + IPTV fork's Setup Sync supports customer-scoped Live TV playlists, guide, favourites and settings after initial authorised sign-in. It does NOT automatically provision TorBox, Xperience, badges or all on-device launcher settings.
- Fire TV remains associated with a configured Amazon account; customer site requires Wi-Fi, and TV HDMI/CEC input and remote volume/power may require on-site calibration.
- Projectivy reliably starting on Fire OS 8 from a power-disconnected boot is **not** guaranteed by merely selecting the home app or installing Launch on Boot. Test the **actual chosen redirect mechanism** and firmware across three cold boots, standby, Home button and Fire OS updates.

**Per-device assembly:**
1. Start with a new Fire Stick registered to a dedicated, recoverable account controlled by the appropriate party. Keep individual customers' Nuvio credentials unique, and use the customer's own account or a securely handed-over account, not the operator account.
2. Install the trusted APKs Projectivy, Nuvio + IPTV, TizenTube and Downloader. Hide noncustomer-facing apps from the Projectivy home screen.
3. Apply Projectivy wallpaper, icon order, Home interception/autostart, and preserve Amazon Settings for Wi-Fi, accessibility and power/volume.
4. In Nuvio + IPTV, sign in as the *demo customer*, add only that customer's Lounge TV Live playlist, enable Setup Sync and verify NZ/AU TV, EPG and paid-service expiry/revoke.
5. Apply a clean copy of the working full Xperience **home layout in the exact original order** to the customer's authorised Nuvio profile; confirm every row and folder populates, metadata posters appear and no personal add-ons/history remain.
6. Set Nuvio hero preference, home catalogue sorting, media playback preferences and **the 18 Nov uploaded custom Fusion pack (not Obsidian)**. Confirm its badge import survives app restart.
7. Treat TorBox/AIOStreams playback as a separate *customer-specific configuration* and pass gate: individual account/key, approved manifest, 4K file size limits and real video play tests. Neither account cloning nor the badge JSON solves premium source provisioning.

**Shipment simulation (GO / NO-GO):**
1. Disconnect power, HDMI and Wi-Fi; move the assembled stick to a different TV/network, without resetting it.
2. Have a person with no previous setup knowledge plug it into HDMI and power, select correct input, connect to household Wi-Fi, and verify remote power/volume.
3. Boot/reboot at least 3 times; Home must consistently return to Projectivy (no stranded Fire home), Nuvio must retain that customer's account.
4. Verify Live TV channel and populated EPG; test multiple movie and series streams where applicable, including 4K, and confirm no duplicate playlist channels.
5. Verify all 10 Xperience home rows in correct order, three collections/41 folders, real metadata, customer custom Fusion badges, TizenTube and hidden support apps. Check after a full power cycle.
6. Confirm subscription deactivation and password/credential handover/repair process without affecting other customers.

**Decision:** Hardware format is technically plausible based on working components and current documentation, but **the complete shippable customer handover has not passed this acceptance test**. Until it passes, do not promise zero-setup delivery, reliable boot interception, automated per-customer On Demand, or recurring remote updates. First new stick is an isolated pilot, not production evidence.
