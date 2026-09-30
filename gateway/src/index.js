const SUPABASE_RPC = "/rest/v1/rpc/resolve_playback_source";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

function joinUrl(base, path) {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return json({ error: "Method not allowed" }, 405);
    }

    const match = url.pathname.match(/^\/live\/([^/]+)$/);
    if (!match) return json({ error: "Not found" }, 404);

    const channelId = decodeURIComponent(match[1]);
    const token = String(url.searchParams.get("token") || "");
    if (!channelId || token.length < 32) {
      return json({ error: "Invalid playback request" }, 400);
    }

    const tokenHash = await sha256(token);

    const rpc = await fetch(env.SUPABASE_URL + SUPABASE_RPC, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        p_token_hash: tokenHash,
        p_logical_channel_id: channelId,
      }),
    });

    if (!rpc.ok) {
      return json({ error: "Playback authorisation failed" }, rpc.status === 404 ? 404 : 403);
    }

    const rows = await rpc.json();
    const source = Array.isArray(rows) ? rows[0] : null;
    if (!source?.source_ref || !source?.server_url ||
        !source?.provider_username || !source?.provider_password) {
      return json({ error: "No playable source available" }, 502);
    }

    let selectedSourceRef = String(source.source_ref);
    let selectedSourceFormat = String(source.source_format || "ts");
    const requestedSourceCuid = String(url.searchParams.get("source") || "").trim();

    if (requestedSourceCuid) {
      const serviceHeaders = {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      };

      const sessionUrl = new URL(env.SUPABASE_URL + "/rest/v1/playback_sessions");
      sessionUrl.searchParams.set("select", "provider_account_id");
      sessionUrl.searchParams.set("token_hash", "eq." + tokenHash);
      sessionUrl.searchParams.set("status", "eq.active");
      sessionUrl.searchParams.set("limit", "1");

      const sessionResponse = await fetch(sessionUrl.toString(), { headers: serviceHeaders });
      const sessionRows = sessionResponse.ok ? await sessionResponse.json() : [];
      const providerAccountId =
        Array.isArray(sessionRows) && sessionRows[0]?.provider_account_id
          ? String(sessionRows[0].provider_account_id)
          : "";

      if (providerAccountId) {
        const accountUrl = new URL(env.SUPABASE_URL + "/rest/v1/provider_accounts");
        accountUrl.searchParams.set("select", "provider_id");
        accountUrl.searchParams.set("id", "eq." + providerAccountId);
        accountUrl.searchParams.set("limit", "1");

        const accountResponse = await fetch(accountUrl.toString(), { headers: serviceHeaders });
        const accountRows = accountResponse.ok ? await accountResponse.json() : [];
        const providerId =
          Array.isArray(accountRows) && accountRows[0]?.provider_id
            ? String(accountRows[0].provider_id)
            : "";

        if (providerId) {
          const candidateUrl = new URL(env.SUPABASE_URL + "/rest/v1/channel_sources");
          candidateUrl.searchParams.set("select", "source_ref,source_format,status");
          candidateUrl.searchParams.set("logical_channel_id", "eq." + channelId);
          candidateUrl.searchParams.set("provider_id", "eq." + providerId);
          candidateUrl.searchParams.set("source_cuid", "eq." + requestedSourceCuid);
          candidateUrl.searchParams.set("limit", "1");

          const candidateResponse = await fetch(candidateUrl.toString(), { headers: serviceHeaders });
          const candidateRows = candidateResponse.ok ? await candidateResponse.json() : [];
          const candidate = Array.isArray(candidateRows) ? candidateRows[0] : null;

          if (
            candidate?.source_ref &&
            !["dead", "wrong", "stale"].includes(String(candidate.status || "unknown"))
          ) {
            selectedSourceRef = String(candidate.source_ref);
            selectedSourceFormat = String(candidate.source_format || selectedSourceFormat);
          }
        }
      }
    }

    const format = selectedSourceFormat.replace(/[^a-z0-9]/gi, "");
    const upstream = joinUrl(
      source.server_url,
      "live/" +
        encodeURIComponent(source.provider_username) + "/" +
        encodeURIComponent(source.provider_password) + "/" +
        encodeURIComponent(selectedSourceRef) + "." + format
    );

    const headers = new Headers();
    const range = request.headers.get("Range");
    if (range) headers.set("Range", range);
    const ua = request.headers.get("User-Agent");
    if (ua) headers.set("User-Agent", ua);

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstream, {
        method: request.method,
        headers,
        redirect: "follow",
      });
    } catch {
      return json({ error: "Upstream stream unavailable" }, 502);
    }

    const responseHeaders = new Headers();
    for (const name of [
      "content-type","content-length","content-range","accept-ranges",
      "etag","last-modified"
    ]) {
      const value = upstreamResponse.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Cache-Control", "no-store, private");
    responseHeaders.set("X-Content-Type-Options", "nosniff");

    return new Response(
      request.method === "HEAD" ? null : upstreamResponse.body,
      {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      }
    );
  },
};
