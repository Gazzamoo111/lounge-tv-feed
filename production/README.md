# Production source contract

`n/` is the complete **deployed** Supabase Edge Function `n` v39 (16 files). `plus/` is the complete **deployed** `lounge-plus-qa` v5 bundle (15 files). These directories are the current development baseline. Start any new gateway change from them; do not reconstruct a partial gateway from historical QA commits.

`release-lock.json` contains every Git blob hash from the frozen, byte-verified release source. It pins v38/Plus v5 rollback and historical v37 held separately in the protected snapshot branch. To deploy, preserve original names, `index.ts` entrypoint, Edge Function slug and JWT settings. This repository does not store private production environment bindings, credentials, database schema/data or Cloudflare route configuration.

Never treat a commit here as an automatic deployment. The Supabase Edge Function is deployed separately and must be read back and tested. Recheck the live version before making a new release. The existing Xtream-to-M3U fallback is an internal DRM compatibility mechanism, not a second user-facing playlist.
