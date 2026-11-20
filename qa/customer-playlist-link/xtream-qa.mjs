import directEpg from "./direct-epg.json" with { type: "json" };
import { rewriteDisplayMetadata } from "./link-core.mjs";

const origin = "https://n.loungetv.nz";
const mount = "/lounge-xtream-direct-epg-qa";
const apiActions = new Set([null, "get_live_categories", "get_live_streams", "get_short_epg"]);
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
const failure = (error, status) => Response.json({ error }, { status, headers: privateHeaders });

function rewritePlaylist(source) {
  const header = /^#EXTM3U x-tvg-url="([^"\r\n]+)"(?=\r?\n)/;
  const original = header.exec(source)?.[1];
  if (!original || new URL(original).origin !== origin || new URL(original).pathname !== "/xmltv.php") {
    throw new Error("Unexpected canonical guide");
  }
  let remaps = 0;
  const playlist = source
    .replace(header, () => `#EXTM3U x-tvg-url="${[original, ...directEpg.guides].join(",")}"`)
    .replace(/^#EXTINF:[^\r\n]*/gm, (line) => {
      const rewritten = rewriteDisplayMetadata(line, directEpg.map);
      const epgId = /\stvg-id="[^"]*"/;
      if (epgId.exec(line)?.[0] !== epgId.exec(rewritten)?.[0]) remaps++;
      return rewritten;
    });
  return { playlist, remaps };
}

export function createXtreamQaHandler(fetcher = fetch) {
  return async (request) => {
    const url = new URL(request.url);
    // Supabase's edge runtime removes /functions/v1 before calling the handler.
    const path = url.pathname.replace(/^\/functions\/v1(?=\/)/, "");
    const mounted = path === mount || path.startsWith(mount + "/");
    const suffix = mounted ? path.slice(mount.length) : path;
    const resource = !suffix || suffix === "/" ? "/player_api.php" : suffix;
    if (request.method !== "GET" ||
        !["/player_api.php", "/get.php", "/xmltv.php"].includes(resource)) {
      return failure("not_found", 404);
    }

    const username = url.searchParams.get("username");
    const password = url.searchParams.get("password");
    if (!username || !password) return failure("not_allowed", 401);
    const action = resource === "/player_api.php" ? url.searchParams.get("action") : null;
    if (!apiActions.has(action)) return failure("not_found", 404);

    const upstreamUrl = new URL(resource, origin);
    for (const [key, value] of url.searchParams) {
      if (["username", "password", "action", "type", "output", "stream_id", "limit", "category_id"].includes(key)) {
        upstreamUrl.searchParams.append(key, value);
      }
    }
    try {
      const upstream = await fetcher(upstreamUrl, { redirect: "error", signal: AbortSignal.timeout(40000) });
      // The existing n gateway checks the Plus account binding and delegates
      // authentication. Only accept responses that took that scoped route.
      if (upstream.headers.get("X-Lounge-Catalogue") !== "plus-qa") {
        await upstream.body?.cancel();
        return upstream.status >= 500 ? failure("qa_upstream_unavailable", 502) : failure("not_allowed", 401);
      }
      const headers = new Headers(privateHeaders);
      const contentType = upstream.headers.get("Content-Type");
      if (contentType) headers.set("Content-Type", contentType);
      if (resource === "/get.php" && upstream.ok) {
        const { playlist, remaps } = rewritePlaylist(await upstream.text());
        headers.set("X-Lounge-QA-EPG-Remaps", String(remaps));
        return new Response(playlist, { headers });
      }
      if (action === "get_live_categories" && upstream.ok) {
        const categories = await upstream.json();
        for (const category of categories) {
          if (typeof category.category_name === "string") {
            category.category_name = category.category_name.replaceAll("&amp;", "&");
          }
        }
        return Response.json(categories, { headers });
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch {
      return failure("qa_upstream_unavailable", 502);
    }
  };
}
