# Recovering the 20 November 2026 source baseline

The [release manifest](release-manifest.json) pins each file to a Git blob or the private unmatched-source archive. It records the observed Supabase version, entrypoint, JWT and import-map settings, deployment timestamp and bundle hash. Source restores preserve the original bytes. GitHub holds the public manifest and the original matching blobs. The archive holds nine deployed files absent from the inspected branch tips, including entrypoints with non-public upstream configuration. Keep the archive private.

## Rehearsed offline recovery

1. In a local clone, fetch the branches and ensure the exact commits listed in the manifest are present. Use an unshallow fetch if the clone lacks a pinned commit. If a branch has moved, use the pinned commit and do not substitute its latest files.
2. Compare the private archive's SHA-256 with the manifest before a full restore.
3. Run the offline restore from the repository root.

   ```sh
   python scripts/restore_playlist_baseline.py --repo . --function n --output /tmp/loungetv-n-baseline
   python scripts/restore_playlist_baseline.py --repo . --archive /private/LoungeTV-Phase1-Unmatched-Edge-Source-20261120.zip --output /tmp/loungetv-full-baseline
   ```

4. The verifier resolves pinned Git blobs, checks every file hash and relative import, and writes a new directory only after verification. The full local rehearsal used a scratch Git object store seeded with exported bytes verified against GitHub tree blob IDs. The restored bundles matched the original export byte for byte. Existing pinned Node tests passed for the custom-domain Worker, no-credential fall-through, Plus routing, International grouping and International Sky mappings. These are offline tests.

## Runtime dependencies and live rollback gate

- Preserve the original Supabase environment configuration and Vault bindings in place. The runtime uses project and database configuration, BEST upstream selection and encrypted account secrets, a Plus verifier, the International QA account and a service-role credential for private storage. Values were not extracted. The archive does not substitute for the Supabase project or a secure operator backup.
- Preserve delivery and core schemas, active release rows, item IDs, category memberships, source bindings, guide store, private guide artifact and the cron schedule. This audit read metadata and aggregate counts. It did not create a database or Cloudflare export.
- Before the first authorised update, record the running Worker deployment/route IDs and current Supabase function bundle hashes. Rehearse a restore using the exact approved bundle in a permitted isolated runtime at no additional cost. Exercise standard and Plus credentials via their assigned QA accounts, customer token paths where relevant, Nuvio M3U import, TVNZ/Sky and AU samples, and check the guide chain. Keep provider credentials and signed responses out of Actions and issue logs.
- In an authorised incident rollback, restore only the affected function or Worker to the last device-verified revision and its original settings. If the affected target is `n`, start with the v37 candidate in the manifest and require the rehearsal above. The v36 reference removes Plus account routing and needs a separate decision. Reconfirm public aliases, authenticated feed output and playback after the restore. If the affected state is data or a Worker route, restore its verified revision independently of Edge Function source.
- A live rollback cannot yet be called tested. The current source restore point is usable for reconstruction. A post-deployment version number may change, so compare the restored code and config as well as the version.

## Phase 2 fixture capture contract

Use a dedicated authorised QA account per region/feed and an independent protected baseline for standard NZ/AU. Save the following output from the same run and record UTC time, public alias, origin slug/version, effective preset, source manifest revision and response branch. For NZ/AU, record both the intentional Xtream fallback response and the resulting M3U.

| Fixture | Retain for CI |
| --- | --- |
| Xtream and M3U | Category ordinals, names and IDs, channel identity and IDs, EPG IDs, logo presence or public references, source classes and counts. Preserve regional intent when classifying duplicates. |
| XMLTV | Validated channel IDs and programme windows with explicit timezone offsets. Store totals for eligible, mapped, now, next and invalid IDs. Keep the eligible denominator and exclusion rules beside each result. |
| Playback | Track separately by device, player version and timestamp. Confirm protected DRM, Sky routing, AU samples and International samples. |

Strip query strings, account path segments, private URLs, licence targets, customer data and response secrets before retaining fixtures or printing test output. Start with offline comparisons and deny anonymous playback as expected. Enable authenticated or device gates only after their own baselines have been captured. Leave the existing EPG workflows and serving routes in place.
