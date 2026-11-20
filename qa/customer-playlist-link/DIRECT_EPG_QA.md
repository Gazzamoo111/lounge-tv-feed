# Direct EPG device-tested baseline

The reported Nuvio device test on 20 November 2026 loaded the enhanced guide.
First load took about five minutes; subsequent loading was normal. Playback
consistency and category display are separate acceptance checks. See
[Lounge TV Issue #10](https://github.com/Gazzamoo111/lounge-tv-feed/issues/10#issuecomment-7030705355).

- Preserve the canonical tokenised Lounge TV guide first. Add the original
  epg66 and epg64 URLs second and third, respectively. The versioned JSON beside
  this file contains only verified mapping metadata and the public source URLs.
- Match the existing stable channel ID and the exact original tvg-id before
  applying the recorded replacement. Unknown or changed entries keep their
  upstream ID. This snapshot is the 967 changed IDs from the successful Plus
  device preview. NZ/AU uses the same guarded mapping for matching rows only.
- Native multi-guide import from one header is unverified. Use Add M3U in
  Settings → Live TV, keep the canonical guide first in Guides, and add the
  two external guides manually in order. Start on the customer's own clean
  app setup. Enable their own Setup Sync only after the listings and playback
  are checked. No operator sync backup or credentials are used.
- Set `LOUNGE_CUSTOMER_DIRECT_EPG_QA=1` only in the scoped QA deployment to
  preview the mappings and ordered setup output. The switch defaults off.
  Direct EPG remains subject to permission for paid customer use.
- Gateway rollback: unset the QA switch to restore original EPG IDs and
  canonical-only issuance. Existing devices must remove the two manual guides
  and refresh the playlist. To also revert the display and access changes,
  restore gateway v2 from commit `331a2d8b4d9687f9526b550a476fe7b9f23adcc9`.
  Revoke any preview link by its link ID if required. The original Plus
  playlist and playback routes remain in service.
