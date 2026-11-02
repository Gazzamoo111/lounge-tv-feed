const LEGACY_PLAYBACK_RPC = "/rest/v1/rpc/resolve_playback_source";
const MAX_PAGE_SIZE = 250;
const XTREAM_BATCH_SIZE = 1000;

function withCors(headers = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Authorization",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "private, max-age=30" : "no-store",
      ...extraHeaders,
    }),
  });
}

function text(body, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(body, {
    status,
    headers: withCors({
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=30",
    }),
  });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

function joinUrl(base, path) {
  return String(base || "").replace(/\/+$/, "") + "/" + String(path || "").replace(/^\/+/, "");
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeString(value, fallback = "") {
  return value == null ? fallback : String(value);
}

function unixSeconds(value) {
  if (!value) return "0";
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? String(Math.floor(ms / 1000)) : "0";
}

function b64(value) {
  const bytes = new TextEncoder().encode(safeString(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function xmlEscape(value) {
  return safeString(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmltvTime(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const z = n => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    z(d.getUTCMonth() + 1) +
    z(d.getUTCDate()) +
    z(d.getUTCHours()) +
    z(d.getUTCMinutes()) +
    z(d.getUTCSeconds()) +
    " +0000"
  );
}

function supabaseHeaders(env) {
  return {
    "Content-Type": "application/json",
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function rpc(env, name, body) {
  const response = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: supabaseHeaders(env),
    body: JSON.stringify(body ?? {}),
  });

  if (!response.ok) {
    throw new Error("delivery rpc failed: " + name + " (" + response.status + ")");
  }

  return response.json();
}

async function restGet(env, table, params) {
  const url = new URL(env.SUPABASE_URL + "/rest/v1/" + table);
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: supabaseHeaders(env),
  });
  if (!response.ok) throw new Error("delivery query failed: " + table);
  return response.json();
}

function credentialsFromRequest(request, url) {
  let username = url.searchParams.get("username") || "";
  let password = url.searchParams.get("password") || "";

  if ((!username || !password) && request.headers.get("Authorization")?.startsWith("Basic ")) {
    try {
      const raw = atob(request.headers.get("Authorization").slice(6));
      const split = raw.indexOf(":");
      if (split >= 0) {
        username = raw.slice(0, split);
        password = raw.slice(split + 1);
      }
    } catch {
      // fall through to normal validation
    }
  }

  return { username, password };
}

async function authenticate(env, username, password) {
  if (!env.CATALOGUE_RELEASE_KEY) {
    return { ok: false, status: "catalogue_release_not_configured" };
  }

  try {
    const result = await rpc(env, "lounge_delivery_authenticate", {
      p_username: username,
      p_password: password,
      p_release_key: env.CATALOGUE_RELEASE_KEY,
    });
    return result && typeof result === "object"
      ? result
      : { ok: false, status: "authentication_failed" };
  } catch {
    return { ok: false, status: "authentication_failed" };
  }
}

async function requireAuth(request, env, url, explicit = null) {
  const creds = explicit || credentialsFromRequest(request, url);
  if (!creds.username || !creds.password) {
    return { error: json({ user_info: { auth: 0, status: "Disabled" } }, 401) };
  }

  const auth = await authenticate(env, creds.username, creds.password);
  if (!auth?.ok) {
    return {
      error: json({
        user_info: {
          auth: 0,
          status: auth?.status === "subscription_not_active" ? "Expired" : "Disabled",
        },
      }, 401),
    };
  }

  return { auth, creds };
}

async function listCategories(env, releaseId, kind) {
  const rows = await rpc(env, "lounge_delivery_list_categories", {
    p_release_id: releaseId,
    p_content_kind: kind,
  });
  return Array.isArray(rows) ? rows : [];
}

async function listItems(env, releaseId, kind, categoryId = null, limit = 500, offset = 0) {
  const rows = await rpc(env, "lounge_delivery_list_items", {
    p_release_id: releaseId,
    p_content_kind: kind,
    p_category_id: categoryId == null ? null : Number(categoryId),
    p_limit: limit,
    p_offset: offset,
  });
  return Array.isArray(rows) ? rows : [];
}

async function listAllItems(env, releaseId, kind, categoryId = null, expectedCount = 0) {
  const all = [];
  let offset = 0;
  const hardCap = Math.max(10000, Number(expectedCount || 0) + 1000);

  while (all.length < hardCap) {
    const page = await listItems(env, releaseId, kind, categoryId, XTREAM_BATCH_SIZE, offset);
    all.push(...page);
    if (page.length < XTREAM_BATCH_SIZE) break;
    offset += page.length;
  }
  return all;
}

async function getReleasedItem(env, releaseId, kind, itemId) {
  const rows = await restGet(env, "lounge_catalogue_items", {
    select: "*",
    release_id: "eq." + releaseId,
    content_kind: "eq." + kind,
    item_id: "eq." + itemId,
    limit: "1",
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

function formatCategory(row) {
  return {
    category_id: String(row.category_id),
    category_name: row.category_name,
    parent_id: 0,
  };
}

function formatLive(row, index = 0) {
  const snapshot = row.snapshot || {};
  return {
    num: index + 1,
    name: row.name,
    stream_type: "live",
    stream_id: Number(row.item_id),
    stream_icon: row.icon_url || "",
    epg_channel_id: row.epg_id || "",
    added: safeString(snapshot.added || "0"),
    is_adult: "0",
    category_id: safeString(row.category_id),
    custom_sid: "",
    tv_archive: 0,
    direct_source: "",
    tv_archive_duration: 0,
  };
}

function formatMovie(row, index = 0) {
  const snapshot = row.snapshot || {};
  const rating = row.rating == null ? "" : String(row.rating);
  return {
    num: index + 1,
    name: row.name,
    stream_type: "movie",
    stream_id: Number(row.item_id),
    stream_icon: row.icon_url || "",
    rating,
    rating_5based: row.rating == null ? 0 : Number(row.rating) / 2,
    added: safeString(snapshot.added || "0"),
    category_id: safeString(row.category_id),
    container_extension: row.container_extension || "mp4",
    custom_sid: "",
    direct_source: "",
  };
}

function formatSeries(row, index = 0) {
  const snapshot = row.snapshot || {};
  return {
    num: index + 1,
    name: row.name,
    series_id: Number(row.item_id),
    cover: row.icon_url || "",
    plot: row.plot || "",
    cast: safeString(snapshot.cast),
    director: safeString(snapshot.director),
    genre: safeString(snapshot.genre),
    releaseDate: safeString(snapshot.release_date || row.release_year || ""),
    last_modified: safeString(snapshot.last_modified || "0"),
    rating: row.rating == null ? "" : String(row.rating),
    rating_5based: row.rating == null ? 0 : Number(row.rating) / 2,
    backdrop_path: row.backdrop_url ? [row.backdrop_url] : [],
    youtube_trailer: safeString(snapshot.youtube_trailer),
    episode_run_time: safeString(snapshot.episode_run_time),
    category_id: safeString(row.category_id),
  };
}

function xtreamUserInfo(auth, username) {
  return {
    username,
    password: "",
    message: "",
    auth: 1,
    status: "Active",
    exp_date: unixSeconds(auth.expires_at),
    is_trial: "0",
    active_cons: "0",
    created_at: "0",
    max_connections: safeString(auth.max_connections || 1),
    allowed_output_formats: ["m3u8", "ts"],
  };
}

function xtreamServerInfo(request) {
  const u = new URL(request.url);
  return {
    url: u.hostname,
    port: u.port || (u.protocol === "https:" ? "443" : "80"),
    https_port: u.protocol === "https:" ? (u.port || "443") : "443",
    server_protocol: u.protocol.replace(":", ""),
    rtmp_port: "0",
    timezone: "Pacific/Auckland",
    timestamp_now: Math.floor(Date.now() / 1000),
    time_now: new Date().toISOString(),
  };
}

function playbackPath(kind, username, password, itemId, ext) {
  const prefix = kind === "episode" ? "series" : kind;
  return (
    "/" + prefix + "/" +
    encodeURIComponent(username) + "/" +
    encodeURIComponent(password) + "/" +
    encodeURIComponent(String(itemId)) + "." +
    encodeURIComponent(ext || (kind === "live" ? "ts" : "mp4"))
  );
}

async function clientKey(request) {
  const raw = [
    request.headers.get("CF-Connecting-IP") || "",
    request.headers.get("User-Agent") || "",
    request.headers.get("CF-Ray")?.split("-")[1] || "",
  ].join("|");
  return sha256(raw);
}

async function resolveReleasedSource(env, auth, request, kind, itemId) {
  const rows = await rpc(env, "lounge_delivery_resolve_source", {
    p_user_id: auth.user_id,
    p_release_id: auth.release_id,
    p_content_kind: kind,
    p_item_id: Number(itemId),
    p_client_key: await clientKey(request),
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.source_ref || !row?.server_url || !row?.provider_username || !row?.provider_password) {
    throw new Error("source unavailable");
  }
  return row;
}

async function proxyReleasedMedia(request, env, auth, kind, itemId) {
  let source;
  try {
    source = await resolveReleasedSource(env, auth, request, kind, itemId);
  } catch {
    return json({ error: "No playable source available" }, 502);
  }

  const format = safeString(source.source_format, kind === "live" ? "ts" : "mp4")
    .replace(/[^a-z0-9]/gi, "") || (kind === "live" ? "ts" : "mp4");

  const upstream = joinUrl(
    source.server_url,
    source.route_kind + "/" +
      encodeURIComponent(source.provider_username) + "/" +
      encodeURIComponent(source.provider_password) + "/" +
      encodeURIComponent(source.source_ref) + "." + format
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
    "content-type", "content-length", "content-range",
    "accept-ranges", "etag", "last-modified"
  ]) {
    const value = upstreamResponse.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Cache-Control", "no-store, private");
  responseHeaders.set("X-Content-Type-Options", "nosniff");

  return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

async function handlePlayerApi(request, env, url) {
  const gate = await requireAuth(request, env, url);
  if (gate.error) return gate.error;
  const { auth, creds } = gate;

  const action = url.searchParams.get("action") || "";
  const categoryId = url.searchParams.get("category_id");

  if (!action) {
    return json({
      user_info: xtreamUserInfo(auth, creds.username),
      server_info: xtreamServerInfo(request),
    });
  }

  if (action === "get_live_categories") {
    return json((await listCategories(env, auth.release_id, "live")).map(formatCategory));
  }
  if (action === "get_vod_categories") {
    return json((await listCategories(env, auth.release_id, "movie")).map(formatCategory));
  }
  if (action === "get_series_categories") {
    return json((await listCategories(env, auth.release_id, "series")).map(formatCategory));
  }

  if (action === "get_live_streams") {
    const rows = await listAllItems(env, auth.release_id, "live", categoryId, auth.live_count);
    return json(rows.map(formatLive));
  }
  if (action === "get_vod_streams") {
    const rows = await listAllItems(env, auth.release_id, "movie", categoryId, auth.movie_count);
    return json(rows.map(formatMovie));
  }
  if (action === "get_series") {
    const rows = await listAllItems(env, auth.release_id, "series", categoryId, auth.series_count);
    return json(rows.map(formatSeries));
  }

  if (action === "get_vod_info") {
    const vodId = Number(url.searchParams.get("vod_id"));
    const row = await getReleasedItem(env, auth.release_id, "movie", vodId);
    if (!row) return json({ info: {}, movie_data: {} }, 404);
    const snapshot = row.snapshot || {};
    return json({
      info: {
        name: row.name,
        movie_image: row.icon_url || "",
        backdrop_path: row.backdrop_url ? [row.backdrop_url] : [],
        plot: row.plot || "",
        rating: row.rating == null ? "" : String(row.rating),
        releasedate: safeString(snapshot.release_date || row.release_year || ""),
        genre: safeString(snapshot.genre),
        cast: safeString(snapshot.cast),
        director: safeString(snapshot.director),
        duration: safeString(snapshot.duration),
      },
      movie_data: formatMovie(row),
    });
  }

  if (action === "get_series_info") {
    const seriesId = Number(url.searchParams.get("series_id"));
    try {
      const result = await rpc(env, "lounge_delivery_series_info", {
        p_release_id: auth.release_id,
        p_series_item_id: seriesId,
      });
      return json(result || { info: {}, episodes: {} });
    } catch {
      return json({ info: {}, episodes: {} }, 404);
    }
  }

  if (action === "get_short_epg" || action === "get_simple_data_table") {
    const streamId = Number(url.searchParams.get("stream_id"));
    const limit = clampInt(url.searchParams.get("limit"), 10, 1, 100);
    try {
      const rows = await rpc(env, "lounge_delivery_epg", {
        p_release_id: auth.release_id,
        p_stream_id: streamId,
        p_hours: 24,
      });
      const listings = (Array.isArray(rows) ? rows : []).slice(0, limit).map((e, i) => ({
        id: String(i + 1),
        epg_id: e.epg_id || "",
        title: b64(e.title || ""),
        lang: "en",
        start: e.start_at,
        end: e.end_at,
        description: b64(e.description || ""),
        channel_id: e.epg_id || "",
        start_timestamp: unixSeconds(e.start_at),
        stop_timestamp: unixSeconds(e.end_at),
      }));
      return json({ epg_listings: listings });
    } catch {
      return json({ epg_listings: [] });
    }
  }

  return json([]);
}

async function handleM3u(request, env, url) {
  const gate = await requireAuth(request, env, url);
  if (gate.error) return gate.error;
  const { auth, creds } = gate;
  const origin = new URL(request.url).origin;
  const rows = await listAllItems(env, auth.release_id, "live", null, auth.live_count);
  const lines = ["#EXTM3U"];

  for (const row of rows) {
    const category = safeString(row.snapshot?.group_title || row.snapshot?.category || "");
    lines.push(
      '#EXTINF:-1 tvg-id="' + safeString(row.epg_id).replaceAll('"', '') +
      '" tvg-logo="' + safeString(row.icon_url).replaceAll('"', '') +
      '" group-title="' + category.replaceAll('"', '') + '",' + row.name
    );
    lines.push(
      origin + playbackPath(
        "live", creds.username, creds.password, row.item_id,
        row.container_extension || "ts"
      )
    );
  }

  return text(lines.join("\n") + "\n", 200, "audio/x-mpegurl; charset=utf-8");
}

async function handleXmltv(request, env, url) {
  const gate = await requireAuth(request, env, url);
  if (gate.error) return gate.error;
  const { auth } = gate;

  const channels = await listAllItems(env, auth.release_id, "live", null, auth.live_count);
  let programmes = [];
  try {
    const rows = await rpc(env, "lounge_delivery_epg", {
      p_release_id: auth.release_id,
      p_stream_id: null,
      p_hours: 72,
    });
    programmes = Array.isArray(rows) ? rows : [];
  } catch {
    programmes = [];
  }

  const byStream = new Map(channels.map(c => [Number(c.item_id), c]));
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="Lounge TV">'];

  for (const c of channels) {
    const id = c.epg_id || ("lounge-" + c.item_id);
    out.push(
      '<channel id="' + xmlEscape(id) + '">' +
      '<display-name>' + xmlEscape(c.name) + '</display-name>' +
      (c.icon_url ? '<icon src="' + xmlEscape(c.icon_url) + '"/>' : '') +
      '</channel>'
    );
  }

  for (const p of programmes) {
    const channel = byStream.get(Number(p.stream_id));
    if (!channel) continue;
    const id = channel.epg_id || ("lounge-" + channel.item_id);
    out.push(
      '<programme start="' + xmlEscape(xmltvTime(p.start_at)) +
      '" stop="' + xmlEscape(xmltvTime(p.end_at)) +
      '" channel="' + xmlEscape(id) + '">' +
      '<title lang="en">' + xmlEscape(p.title) + '</title>' +
      (p.description ? '<desc lang="en">' + xmlEscape(p.description) + '</desc>' : '') +
      (p.icon_url ? '<icon src="' + xmlEscape(p.icon_url) + '"/>' : '') +
      '</programme>'
    );
  }

  out.push("</tv>");
  return text(out.join("\n"), 200, "application/xml; charset=utf-8");
}

async function handleLoungeCatalogue(request, env, url) {
  const gate = await requireAuth(request, env, url);
  if (gate.error) return gate.error;
  const { auth } = gate;

  const kind = url.searchParams.get("kind");
  if (!kind) {
    const [live, movie, series] = await Promise.all([
      listCategories(env, auth.release_id, "live"),
      listCategories(env, auth.release_id, "movie"),
      listCategories(env, auth.release_id, "series"),
    ]);
    return json({
      release: {
        key: auth.release_key,
        live_count: auth.live_count,
        movie_count: auth.movie_count,
        series_count: auth.series_count,
      },
      sections: {
        live,
        movies: movie,
        series,
        streaming: [
          ...movie.filter(x => x.view_group === "streaming"),
          ...series.filter(x => x.view_group === "streaming"),
        ],
        kids_family: [
          ...movie.filter(x => x.view_group === "kids"),
          ...series.filter(x => x.view_group === "kids"),
        ],
      },
    });
  }

  if (!["live", "movie", "series"].includes(kind)) {
    return json({ error: "Invalid catalogue kind" }, 400);
  }

  const limit = clampInt(url.searchParams.get("limit"), 100, 1, MAX_PAGE_SIZE);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);
  const category = url.searchParams.get("category_id");
  const rows = await listItems(env, auth.release_id, kind, category, limit, offset);

  return json({
    release_key: auth.release_key,
    kind,
    category_id: category,
    limit,
    offset,
    items: kind === "live"
      ? rows.map(formatLive)
      : kind === "movie"
        ? rows.map(formatMovie)
        : rows.map(formatSeries),
  });
}

async function handleReleasedPlayback(request, env, url) {
  const match = url.pathname.match(/^\/(live|movie|series)\/([^/]+)\/([^/]+)\/(\d+)(?:\.([A-Za-z0-9]+))?$/);
  if (!match) return null;

  const route = match[1];
  const username = decodeURIComponent(match[2]);
  const password = decodeURIComponent(match[3]);
  const itemId = Number(match[4]);

  const gate = await requireAuth(request, env, url, { username, password });
  if (gate.error) return gate.error;

  const kind = route === "series" ? "episode" : route;
  return proxyReleasedMedia(request, env, gate.auth, kind, itemId);
}

async function handleLegacyLive(request, env, url) {
  const match = url.pathname.match(/^\/live\/([^/]+)$/);
  if (!match) return null;

  const channelId = decodeURIComponent(match[1]);
  const token = String(url.searchParams.get("token") || "");
  if (!channelId || token.length < 32) {
    return json({ error: "Invalid playback request" }, 400);
  }

  const tokenHash = await sha256(token);
  const rpcResponse = await fetch(env.SUPABASE_URL + LEGACY_PLAYBACK_RPC, {
    method: "POST",
    headers: supabaseHeaders(env),
    body: JSON.stringify({
      p_token_hash: tokenHash,
      p_logical_channel_id: channelId,
    }),
  });

  if (!rpcResponse.ok) {
    return json({ error: "Playback authorisation failed" }, rpcResponse.status === 404 ? 404 : 403);
  }

  const rows = await rpcResponse.json();
  const source = Array.isArray(rows) ? rows[0] : null;
  if (!source?.source_ref || !source?.server_url ||
      !source?.provider_username || !source?.provider_password) {
    return json({ error: "No playable source available" }, 502);
  }

  const format = safeString(source.source_format, "ts").replace(/[^a-z0-9]/gi, "") || "ts";
  const upstream = joinUrl(
    source.server_url,
    "live/" +
      encodeURIComponent(source.provider_username) + "/" +
      encodeURIComponent(source.provider_password) + "/" +
      encodeURIComponent(source.source_ref) + "." + format
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
    "content-type", "content-length", "content-range",
    "accept-ranges", "etag", "last-modified"
  ]) {
    const value = upstreamResponse.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Cache-Control", "no-store, private");
  responseHeaders.set("X-Content-Type-Options", "nosniff");

  return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export {
  formatCategory,
  formatLive,
  formatMovie,
  formatSeries,
  playbackPath,
  xmlEscape,
};

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: withCors() });
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/_health") {
    return json({
      ok: true,
      service: "lounge-tv-gateway",
      release: env.CATALOGUE_RELEASE_KEY || null,
    });
  }

  if (url.pathname === "/player_api.php") {
    return handlePlayerApi(request, env, url);
  }
  if (url.pathname === "/get.php") {
    return handleM3u(request, env, url);
  }
  if (url.pathname === "/xmltv.php") {
    return handleXmltv(request, env, url);
  }
  if (url.pathname === "/api/v1/catalogue") {
    return handleLoungeCatalogue(request, env, url);
  }

  const releasedPlayback = await handleReleasedPlayback(request, env, url);
  if (releasedPlayback) return releasedPlayback;

  const legacy = await handleLegacyLive(request, env, url);
  if (legacy) return legacy;

  return json({ error: "Not found" }, 404);
}

export default {
  fetch: handleRequest,
};
