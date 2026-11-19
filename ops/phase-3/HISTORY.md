# Playlist and EPG release history

## 20 November 2026 NZDT | Phase 3 framework rehearsal

- **Scope** Both independent QA plans were pinned to Phase 2 commit `ac6b50abf10af3831b3eeb937354f9abac7e36c4`. The proposal changed release tooling, CI and operating records.
- **Read-only verification** All 15 audited Supabase versions, package hashes and JWT/import-map settings matched Phase 1. The 45 deployed source files for NZ/AU v37, Plus v5 and Regional v4 matched their Phase 1 file digests.
- **Automated verification** Phase 2 validator and gateway replay passed. Phase 3 checks exercised approval and evidence binding, target scope and missing evidence. Local rollback restored the selected bundles byte for byte with identical synthetic feed responses and the peer target unchanged. A deliberate NZ/AU fallback status regression was blocked. See Issue #10 for CI evidence.
- **Authenticated and device evidence** Pending. A real isolated runtime rollback has not been rehearsed. See [the process and requirements](RELEASE.md).
- **Deployment** None. Staging was not configured or approved. No production activity. International retains its existing Regional v4 QA route, with no verified production destination.
- **Rollback reference** [Phase 1 recovery](../phase-1/RECOVERY.md) covers `n` v37, Plus v5 and Regional v4. The offline rehearsal restored 45 files across those three bundles.

For subsequent entries record timestamp, target, manifest digest and source SHA, authorisation, planned and actual changes, automated/authenticated/device results, failures or skips, deployment versions and hashes, rollback reference/result and the Issue #10 and current-state updates.
