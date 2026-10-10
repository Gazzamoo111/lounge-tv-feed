/*
 * Lounge TV shared content API v1, staging only.
 * Only curated metadata lives in private R2. Playback is handled by
 * the existing authenticated playback service, not by this content API.
 *
 * Authentication uses the existing Supabase device-status Edge Function.
 * No Supabase service-role key is stored in or needed by this Worker.
 */
const routes = {
  "/v1/manifest": "manifest.json",
  "/v1/catalogue": "live.json",
  "/v1/vod": "vod.json",
  "/v1/epg": "epg.json",
};
const baseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
  Vary: "X-Device-Id, X-Device-Token",
};
const reply = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: baseHeaders });

const validDate = (value) => {
  if (value == null) return true; // existing subscriptions can be open-ended
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
};

async function authorised(request, env) {
  const id = (request.headers.get("X-Device-Id") || "").trim();
  const token = (request.headers.get("X-Device-Token") || "").trim();
  if (!/^[a-f0-9-]{36}$/i.test(id) || token.length < 32 || token.length > 256) {
    return false;
  }
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)) {
    throw new Error("Supabase endpoint not configured");
  }

  const response = await fetch(base + "/functions/v1/device-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": id,
      "X-Device-Token": token,
    },
    body: JSON.stringify({ action: "status" }),
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) throw new Error("Device status unavailable");
  const data = await response.json();

  // Fail closed if the existing entitlement system doesn't give a full match.
  return data?.ok === true &&
    data?.device?.id === id &&
    data?.device?.status === "active" &&
    data?.subscription?.status === "active" &&
    validDate(data.subscription.current_period_end) &&
    data?.service?.status === "active" &&
    validDate(data.service.expires_at);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
        "Access-Control-Allow-Headers": "X-Device-Id,X-Device-Token,Content-Type,If-None-Match",
      },
    });

    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply({ error: "Method not allowed" }, 405);
    }

    const path = new URL(request.url).pathname;
    if (path === "/v1/health") {
      return reply({ ok: true, enabled: env.CONTENT_ENABLED === "true" });
    }
    if (!routes[path]) return reply({ error: "Not found" }, 404);
    if (env.CONTENT_ENABLED !== "true") {
      return reply({ error: "Content not yet published" }, 503);
    }
    if (!env.CONTENT || !env.SUPABASE_URL) {
      return reply({ error: "Service not configured" }, 503);
    }

    let allowed;
    try {
      allowed = await authorised(request, env);
    } catch (_) {
      return reply({ error: "Authorisation unavailable" }, 503);
    }
    if (!allowed) return reply({ error: "Inactive device or subscription" }, 401);

    let pointer;
    try {
      pointer = await env.CONTENT.get("shared/v1/current.json");
    } catch (_) {
      return reply({ error: "Catalogue unavailable" }, 503);
    }
    if (!pointer) return reply({ error: "No catalogue published" }, 503);
    let revision;
    try {
      revision = JSON.parse(await pointer.text()).revision;
    } catch (_) {
      return reply({ error: "Invalid catalogue pointer" }, 503);
    }
    if (!/^[A-Za-z0-9._-]{8,64}$/.test(revision || "")) {
      return reply({ error: "Invalid revision" }, 503);
    }

    let file;
    try {
      file = await env.CONTENT.get("shared/v1/releases/" + revision + "/" + routes[path]);
    } catch (_) {
      return reply({ error: "Catalogue unavailable" }, 503);
    }
    if (!file) return reply({ error: "Content not found" }, 503);
    const headers = {
      ...baseHeaders,
      ETag: file.httpEtag || '"' + revision + '"',
      "X-Lounge-Catalogue-Revision": revision,
    };
    if (request.headers.get("If-None-Match") === headers.ETag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === "HEAD" ? null : file.body, {
      status: 200,
      headers,
    });
  },
};
