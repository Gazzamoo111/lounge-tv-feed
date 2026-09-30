# Lounge TV Media Gateway

This Worker is the Lounge TV media data plane.

## Security model

The TV sends only:
- Lounge logical channel ID
- short-lived Lounge playback token

The Worker:
1. hashes the Lounge playback token,
2. asks Supabase to resolve the authorised provider source,
3. receives provider credentials server-side from Supabase Vault,
4. fetches the upstream stream,
5. streams bytes to the TV without returning provider credentials.

Never commit:
- SUPABASE_SERVICE_ROLE_KEY
- provider usernames/passwords
- provider server credentials

Required Worker secrets:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

The current public Lounge feed must not be switched to this gateway until the TV app has been patched and tested on the LG TV.
