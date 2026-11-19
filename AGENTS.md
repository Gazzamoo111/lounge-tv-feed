# Lounge TV: Agent Operating Rules

This is a public repository. Never commit credentials, provider account details, signed URLs, tokens, private access keys, customer personal information or decrypted DRM material.

## Mandatory read at the start of every playlist/EPG task
1. Read ops/CURRENT_STATE.md.
2. Read ops/OPERATING_PLAYBOOK.md and ops/REGRESSION_CHECKLIST.md.
3. Read the applicable GitHub issue, related diffs and the current source files.
4. Read the current Supabase Edge Function versions and inspect the actual targeted implementation before changing anything.
5. Establish whether the target is NZ/AU, International QA, an EPG feed, or a customer-facing production endpoint. Do not infer routing solely from a function name or stale issue.

## Source of truth and evidence
- Verified deployed function source and a live endpoint check establish what is presently serving customers. The repository must be reconciled to the deployment before changing it.
- GitHub controls the intended implementation, version history, change requests and operational decisions.
- ops/CURRENT_STATE.md is the latest documented snapshot. Update it only with attributable, verified facts; identify uncertainty and timestamps.
- Old issues, prior chats and the README are historical context, not automatically current facts.
- A function being ACTIVE or a request returning HTTP 200 does not prove stream playback or accurate EPG.

## Safety rules
- No production changes during discovery, documentation updates, inventory or an unapproved QA exercise.
- Never overwrite the last known-good NZ/AU feed while working on International QA or EPG.
- Preserve category names/order/icons, stable channel identity, alternate sources and EPG mappings unless the change specifically targets them.
- Keep playback-source selection separate from EPG mapping; do not break playback to improve guide coverage.
- Never solve DRM issues by bypassing licensing controls. Use legally authorised sources and compatible clients.
- Use smallest-scoped reversible changes; keep rollback reference and baseline evidence.
- No Supabase paid upgrade, paid branching or new ongoing cost without explicit approval; keep on free-tier constraints.
- Never claim a device playback test was completed without actual device evidence.
- Do not ask the user to repeat details obtainable from connected GitHub, Supabase or a current issue.

## Execution contract
Discover -> snapshot -> specify intended diff -> implement isolated change -> automated validation -> real-device verification if needed -> approved release -> follow-up monitoring -> update records.

For every task, maintain a GitHub issue as durable log. On task completion, report: target, changed files/functions, test evidence, device verification status, release status, rollback reference, remaining blockers. Do not call partially tested changes complete.

For long tasks and new chats, start by reading this file and the state file, not by asking the user to retell history.
