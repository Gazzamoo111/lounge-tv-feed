# Playlist and EPG Regression Checklist

This document defines REQUIRED CHECKS, not claims that tests currently exist. Automation implementation is tracked in the operating-system GitHub issue.

## A. Catalogue and formatting
- [ ] Save pre-change category order and category/channel counts for targeted feed.
- [ ] Confirm no unintended categories inserted, deleted, moved or renamed.
- [ ] Confirm icons, logos, normalised names and escaping (no leaked HTML entities such as &amp;).
- [ ] Confirm channel IDs are stable where clients use favourites or guide mappings.
- [ ] Check duplicates by provider ID, logical channel identity and regional intent. Never remove a region-specific programme variant solely because names match.
- [ ] Preserve expected 24/7 category splits and all explicitly approved sports-event discovery inventory.
- [ ] Confirm unrelated NZ/AU data remains unchanged during an International task.

## B. EPG
- [ ] XMLTV/guide source parses successfully and programme times/time zones are valid.
- [ ] Compare targeted EPG channel ID mappings with baseline and identify unmapped channels.
- [ ] Produce before/after counts: total eligible channels, mapped channels, channels with a current programme, channels with next programme.
- [ ] Verify now/next alignment on a representative NZ, AU, UK, US, sports, movie and children set.
- [ ] Distinguish missing upstream programmes, bad matching IDs, refresh timing and Nuvio guide-import limitations.
- [ ] Confirm EPG changes do not create extra visible playlist entries or duplicate categories.

## C. Protected playback flows
- [ ] NZ: TVNZ 1 and TVNZ 2 through their authorised, compatible playback path.
- [ ] NZ: Three, Whakaata Maori and Te Reo placement/mapping as configured.
- [ ] NZ: Sky Sport 1-9 source priority and startup/buffering checks.
- [ ] AU: representative free-to-air main networks and regional variants.
- [ ] AU: Fox/Kayo or other provider-dependent sports where available; explicitly identify upstream failures.
- [ ] UK/US: representative general, premium, sports and event channels relevant to the change.
- [ ] Verified fallback routes do not silently replace reliable sources with nominally higher resolution.
- [ ] DRM: no unlicensed bypass; test with authorised stream access and supported player.

## D. Customer and deployment
- [ ] Verify exact public route, function and version; do not equate ACTIVE with serving customers.
- [ ] Compare changed feeds to existing customer login / assigned BEST service without exposing credentials.
- [ ] Confirm Nuvio playlist import and EPG via actual client where required.
- [ ] Verify no unintended customer credential or playlist exposure.
- [ ] Capture source snapshot, release identifier, check logs, and rollback instructions.
- [ ] Mark each check PASS, FAIL, NOT TESTED or NOT APPLICABLE with evidence.
- [ ] Never ship a critical regression with a passing summary.

## Evidence standard
Metadata and automated checks can establish structure and coverage but cannot prove uninterrupted viewing. Record user/device-tested playback separately, with device type and test date. No blanket claims such as all streams work without representative end-to-end evidence.
