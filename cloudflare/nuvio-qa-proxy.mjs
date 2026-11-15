// QA-only Cloudflare Worker for https://connect.loungetv.nz/n
// Deploy on a dedicated /n* Worker route; do not replace the production Worker.
// Route: connect.loungetv.nz/n*
// Upstream Supabase QA function: n (NOT lounge-core-xtream).
const UPSTREAM_ORIGIN = "https://liqocisegeqzbyuqloql.supabase.co";
const PUBLIC_HOST = "connect.loungetv.nz";
const QA_PREFIX = "/n";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    if (incoming.hostname !== PUBLIC_HOST ||
        !(incoming.pathname === QA_PREFIX || incoming.pathname.startsWith(QA_PREFIX + "/"))) {
      return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    const suffix = incoming.pathname.slice(QA_PREFIX.length);
    const target = new URL(UPSTREAM_ORIGIN + "/functions/v1/n" + suffix);
    target.search = incoming.search;
    // The QA function uses this when generating M3U + XMLTV links.
    // This remains QA-only and does not change the production gateway.
    target.searchParams.set("_lounge_host", PUBLIC_HOST + QA_PREFIX);

    const headers = new Headers(request.headers);
    headers.delete("host");
    // No request URLs, credentials or bearer tokens are ever logged by this Worker.
    const upstreamRequest = new Request(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });

    try {
      const upstreamResponse = await fetch(upstreamRequest);
      const responseHeaders = new Headers(upstreamResponse.headers);
      responseHeaders.set("Cache-Control", "private, no-store");
      responseHeaders.set("X-Lounge-QA-Route", "n");
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch {
      return new Response(JSON.stringify({ error: "qa_gateway_unavailable" }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  },
};
