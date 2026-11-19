# Lounge TV Playlist and EPG Operating Playbook

## Goal
A single durable process for NZ/AU, UK/US/International, EPG and live incident work, without repeatedly reconstructing context from ChatGPT chats.

## What goes where
- GitHub issues: one change request or incident per deliverable. Record all decisions, baseline, steps, results and remaining risks.
- GitHub files: versioned implementation, configuration, validation scripts, docs, deployment manifests, test results that are safe to publish.
- Supabase: runtime database and deployed functions. Never use the deployed runtime as the only surviving copy of source code.
- ChatGPT Project: user interface for requests, analysis and supervised execution. Chats are not the permanent project record.

## Intake
A task can be as brief as: Audit the UK category, remove verified duplicates and improve EPG, preserve NZ/AU.
Before changing anything:
1. Read AGENTS.md and ops/CURRENT_STATE.md.
2. Find or create a GitHub issue and confirm current environment, implementation and customer impact.
3. Classify request: catalogue presentation, channel source routing, EPG mapping, provider issue, account/playlist setup or infrastructure.
4. Document the exact requested changes and what must remain unchanged. Use the existing tested configuration as baseline.
5. Investigate historical notes only for context; use present GitHub/Supabase state to establish facts.

## Standard change process
1. READ-ONLY AUDIT: identify deployed versions, source parity, feed size, group order, channel ID metadata, EPG baseline and known faults.
2. SNAPSHOT: create recoverable source/config baseline. Store only public-safe contents; credentials stay in private managed secrets.
3. CHANGE: make a small diff on a GitHub branch or an isolated QA configuration/function. Do not edit serving production directly.
4. VALIDATE: inspect the output and compare against baseline using ops/REGRESSION_CHECKLIST.md. Report counts, changed IDs, EPG match percentage and any relevant playback failures.
5. VERIFY: where stream startup, DRM, buffering or Nuvio-specific behaviour matters, test on an actual target device. Automated metadata checks are not substitutes.
6. RELEASE: only change production if that action was explicitly authorised for this task and the release gates passed. Preserve immutable rollback reference.
7. RECORD: post issue update, revision references, release outcome, failure notes, device confirmation and adjust ops/CURRENT_STATE.md with verified changes.

## Types of work
- BATCH CLEANUP: names, icons, category order, region grouping, safe duplicate suppression and EPG improvements are grouped in one scoped issue.
- BREAK/FIX HOTFIX: TVNZ, Sky or broad channel outage becomes a separate incident with the last known-good stream routing preserved and a focused rollback path.
- INTERNATIONAL: independent QA and release gate; never adjust NZ/AU production as a side effect.
- PROVIDER FAILURE: distinguish playlist metadata or gateway bug from upstream BEST source failure. Do not falsely label provider outages as code fixes.

## Release gates
- The exact serving URL-to-function routing is known.
- Baseline code/config is recoverable.
- Intended diff matches the request and unintended changes are explicitly enumerated.
- Automated structural and EPG checks pass (or documented exceptions are approved).
- Critical playback tested on compatible Nuvio + IPTV client where applicable.
- Separate customer credentials, token expiry and DRM flows are not disturbed.
- A rollback reference and operator steps are documented before promotion.
- Production scope has been authorised by the user.

## Handoffs
When ending a chat or reaching context limits: update the GitHub issue and state file before stopping. A new chat reads those records first. Avoid adding long handover prose that only survives in the previous chat.

## Required response after execution
Target and version; implemented changes; automated check results; real device confirmation or not tested; production status; rollback reference; unresolved risks; the next necessary action. Never report a pass without evidence.

## Controlled release records

Use the [Phase 3 release process](phase-3/RELEASE.md) for single-target candidate manifests, approval, staging and promotion gates, and rollback. Log every attempt in [release history](phase-3/HISTORY.md), the relevant issue and [CURRENT_STATE.md](CURRENT_STATE.md).
