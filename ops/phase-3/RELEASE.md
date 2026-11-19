# Controlled Playlist and EPG releases

Work on one target per release. NZ/AU includes standard and Plus. International is Regional v4 and currently has a QA destination only. The [target configuration](targets.json) and [NZ/AU](nz-au-baseline.json) and [International](international-baseline.json) manifests record the starting scope. Issue [#10](https://github.com/Gazzamoo111/lounge-tv-feed/issues/10) is the release log. The [operating playbook](../OPERATING_PLAYBOOK.md) still applies.

## 1. Prepare and validate

1. Create a source candidate from the Phase 2 revision in the target configuration. Put intentional catalogue changes at the pinned source paths. Review any changed synthetic expectations against the baseline. This version of the gate supports existing bundle paths and target fixtures. Shared guide, Worker, schema, dependency, file layout and runtime configuration changes need a separately reviewed release plan before they can enter the gate. Keep Phase 3 tooling and release record commits off the candidate's source branch.
2. In the Phase 3 checkout, fetch the candidate and the pinned source refs in the [Phase 2 instructions](../phase-2/REGRESSION.md). Create a manifest from the full committed source SHA. Include the manifest in a reviewable release record, with the approved scope and any expected catalogue differences. Candidate file digests are deployment inputs. Observed Supabase versions and package digests describe the pre-release baseline. Record the actual new versions and package digests after any deployment.
3. Run validation. The gate recomputes the manifest and runs all Phase 2 tests from the pinned candidate in a fresh checkout. An out-of-scope diff, missing source, changed peer files or failing test blocks staging, bundle export and promotion. Candidate changes to gate code, workflows, replay code and validators are outside the allowed release diff.

```sh
python scripts/playlist_release.py plan nz-au "$CANDIDATE_SHA" > /private/release.json
python scripts/playlist_release.py validate /private/release.json
python scripts/playlist_release.py bundle /private/release.json /private/release-bundles
```

The bundle command writes only the selected target to a new local directory, checking every exported file digest against the reviewed manifest. The CLI runs no deploy commands. Use the published CI run plus the gate result to document proposed changes.

## 2. Authorise isolated staging

1. Choose a local Supabase runtime or an existing dedicated free staging project with independent schema, Vault, guide data and storage. Use the same function slugs as the selected profile because routing and generated playback URLs depend on them. Set all URL and DB inputs and verify generated routes, including redirects and licence routes, point to the isolated bindings or authorised QA upstreams. The deployed code has a production Supabase URL fallback, so explicitly verify egress denies the production project and aliases, including calls made from the QA device. Allow only required QA provider, guide and licence destinations. Reject a staging setup with any production database, customer account, shared writes, cron, storage or route bindings. Record the route and isolation check privately. Use a restricted network for device access to a local stack.
2. The repo owner must explicitly approve the exact manifest digest and staging environment in Issue #10. Verify the author, timestamp, manifest digest, target, environment and action directly in the real GitHub comment. On a private operator machine, create an evidence record using the format below and run `python scripts/playlist_release.py stage /private/release.json /private/evidence.json`. This permits authorised staging only after the offline checks and operator verification. Record any staged bundle's slug, version, package digest, settings, route and timestamp.
3. Capture the baseline and candidate feeds and test devices. Exercise the selected profile plus its related routing, including standard-versus-Plus account selection for NZ/AU. Record a read-only peer baseline and post-change comparison to confirm isolation. Any discrepancy or unverified required case keeps promotion blocked.

### Local evidence record

The CLI checks the shape, manifest digest, approval order and required receipts. Verify GitHub approvals, isolation and the underlying evidence directly before relying on the result. A locally authored JSON record cannot establish who gave approval or whether device testing occurred. Keep the evidence file and all raw artifacts outside GitHub and CI. Use the SHA-256 of the generated canonical manifest as `manifest_sha256`.

| Field | Required value |
| --- | --- |
| `schema`, `manifest_sha256` | `1` and SHA-256 of the generated manifest |
| `staging` | Object with `project` set to `local` or the separate project ref, and `function_slugs` equal to the manifest's `profiles` |
| `stage_approval`, `promotion_approval` | Null until approved, then an object with `owner`, `issue_comment_id` and offset-aware `approved_at`. Production needs a distinct later comment tied to the manifest, destination and digests of the reviewed evidence |
| `authenticated`, `device` | Per-profile receipt objects. Leave pending entries null |
| `rollback` | Null until tested, then an object with `mode` set to `isolated-runtime` and `evidence` containing the receipt |
| `runtime` | Receipt for current serving route and runtime inventory, expected dependency versions and rollback parity |

A receipt contains `result`, `observed_at` with UTC offset and `private_evidence_sha256`. Hash the corresponding private report, which must name the manifest digest, target, route, profiles, actual function versions and result. Only `pass` passes the gate. Record failures and skips in the history. Use an evidence observation time after staging approval and before promotion approval.

### Authenticated feeds and Nuvio

- Use authorised dedicated test accounts and service assignments. Preserve the expected account-specific 503 fallback, the DRM-aware M3U and the guide branch. Capture M3U, Xtream status/categories/streams and XMLTV privately following [Phase 2](../phase-2/REGRESSION.md). Compare baseline and candidate with matching fixtures and one declared UTC comparison time. Record counts, IDs, categories, icons, duplicates and region intent, EPG mapping and now/next coverage, and account isolation. Document any planned delta and its approval. Check the actual QA route, origin and version from isolated deployment metadata. The Phase 2 projection's alias and slug are profile labels and cannot establish which endpoint served the private export.
- Authenticate using the operator's private credentials store. Avoid entering full URLs in command-line arguments, shell history, verbose logs or clipboard sync. Use a trusted local client, restrictive directory permissions and restricted network access. Save raw responses and request data only as long as needed in private storage. Keep all projections private, including catalogue IDs. Public history may include aggregate counts, versions, redacted outcomes and digests. Never publish raw bodies, URLs with query or account segments, redirect locations, licence targets, tokens or screenshots that show account details.
- In Nuvio + IPTV, record device model, app version, time, selected test playlist and guide import. For NZ/AU, test standard and Plus, TVNZ 1/2 with authorised DRM, Sky Sport 1–9 and representative AU streams, including provider failures. For Regional v4, test representative UK/US and regional variants plus guide now/next. Test startup and sustained playback on critical paths. Record each check separately, including anything untested. Deployed metadata, authenticated feed output and actual playback establish different facts.

## 3. Rehearse and prepare rollback

The automated rehearsal uses a temporary directory and the pinned replay harness with synthetic/stubbed dependencies.

```sh
python scripts/playlist_release.py rehearse
```

For actual acceptance, record the isolated runtime's route, config, dependencies and baseline hashes. Apply the candidate in staging, confirm the intended scope, then restore the prior verified code and settings for the affected functions only. For NZ/AU use `n` v37 and Plus v5 from the [Phase 1 recovery record](../phase-1/RECOVERY.md). The v36 reference drops Plus delegation. For International use Regional v4 and preserve both master QA services. Compare restored bytes, entrypoint, JWT/import map, route, peer functions and dependencies with the pre-change inventory. Verify authenticated feeds, guides and Nuvio playback again. Supabase may assign new version numbers on redeploy. Match source/config and behaviour as well as recording versions. Capture a private rollback report and only then add the isolated-runtime receipt.

## 4. Authorise and record production

Refresh serving aliases, Worker deployment IDs, function versions and digests, guide/store bindings, scopes and rollback parity. If any required information is unavailable or changed, stop and re-establish the baseline. For NZ/AU, the owner must approve the exact manifest and production route after reviewing the auth, device and rollback evidence. Run `python scripts/playlist_release.py promote /private/release.json /private/evidence.json`, verify the actual GitHub approval and evidence, and deploy only the authorised artifacts using the approved operator procedure. Regional v4 cannot promote until a verified production route is reviewed and added. Keep a pre-change recovery point available throughout.

After any authorised deployment, record observed route, version and hashes, perform authenticated and device checks, and confirm the peer is isolated. A protected failure or scope drift triggers the approved incident rollback for the affected target. Record actual restored configuration and repeat the affected checks. Separate approval or a pre-authorised rollback trigger must cover any incident change.

Every attempt, including a blocked gate, failure or rollback, gets a dated record in [release history](HISTORY.md), a matching update to Issue #10, and an update to [CURRENT_STATE.md](../CURRENT_STATE.md) stating what was actually deployed and verified. Use the existing issue and state doc for handoffs. Publish target, change summary, manifest/source, stage/gate outcome, tests by evidence type, observed runtime versions, rollback reference and unresolved checks. Record failures before retrying so the next operator can trace decisions.
