# Lounge TV independent XMLTV source

Isolated standalone guide route for Nuvio + IPTV. No change to any existing Xtream, Supabase, Cloudflare gateway, playback, account or database.

## Design

Nuvio + IPTV > Settings > Live TV > Add EPG Source (additional XMLTV guide). Do **not** add a new Xtream login or an M3U playlist; this guide is schedules only.

Intended URL, **NOT LIVE UNTIL DEPLOYMENT**:
https://epg.loungetv.nz/guide.xml.gz?key=<PRIVATE_TOKEN>

Cloudflare Worker routes only this new subdomain. It authorizes a query token stored as a Worker secret, retrieves the genuine compiled \`LoungeTV_Unified_EPG.xml.gz\` from a private R2 bucket \`loungetv-epg-private\` at \`guides/current.xml.gz\`, and returns raw gzip XMLTV. Neither customer stream URLs nor M3U are hosted on this endpoint.

## Release prerequisites

1. Check current DNS and existing Cloudflare zone routes. Create \`epg.loungetv.nz\` on the correct zone, separate from every serving endpoint.
2. Confirm the R2 free tier and create private bucket \`loungetv-epg-private\`. Never grant public bucket access.
3. Provision a strong random Worker secret \`EPG_READ_TOKEN\` with the Cloudflare dashboard or \`wrangler secret put EPG_READ_TOKEN\`; do not store token in GitHub or issue comments.
4. Take \`LoungeTV_Unified_EPG.xml.gz\` from the final **private** Issue #22 deliverables, verify SHA256 and validate XMLTV content. Do not use the M3U.
5. Upload the guide as \`guides/current.xml.gz\` to private R2, e.g. \`wrangler r2 object put loungetv-epg-private/guides/current.xml.gz --file /path/to/LoungeTV_Unified_EPG.xml.gz --remote\`.
6. Deploy this standalone Worker and attach *only* its new \`epg.loungetv.nz\` route, after checking any existing hostname is not owned elsewhere.
7. Verify unauthenticated GET = 404, valid token GET = 200 gzip, gzip XMLTV parses, ETag/HEAD works, no credentials in guide, \`/health\` = 200. Run actual Nuvio import, spot check representative channel matching, and confirm Xtream unchanged.
8. Establish a separate authenticated scheduled source refresh and atomic upload only after one-off delivery is accepted. Never publish the private M3U or guide in a public GitHub commit.

**Important matching limitation:** The final XMLTV uses \`ltv.*\` IDs generated for the approved portable master M3U, which is **not the same channel-ID system** as the existing Nuvio Xtream login. Nuvio's intelligent name matching/Assign EPG may recover many, but the 72.88% match rate measured against the portable master is NOT a guarantee of 72.88% coverage on the existing Xtream login. Measure this separately on device. Do not edit current Xtream IDs in order to force a match.

Run tests with: \`node --test standalone-epg/worker/tests/worker.test.mjs\`.

No production, Supabase or Nuvio change is made by committing these files.
