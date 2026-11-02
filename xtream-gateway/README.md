# Lounge TV Xtream Gateway

Customer-facing Xtream hostname:

- https://connect.loungetv.nz

This Worker forwards Xtream API, M3U, XMLTV and playback requests to the Lounge canonical catalogue gateway.

It deliberately preserves upstream playback redirects instead of proxying video bytes through Cloudflare.

Deploy from this directory:

```bash
npx wrangler deploy
```

Wrangler will create the Custom Domain DNS record and SSL certificate for `connect.loungetv.nz`.
