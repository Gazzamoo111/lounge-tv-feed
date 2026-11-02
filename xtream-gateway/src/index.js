const UPSTREAM = "https://liqocisegeqzbyuqloql.supabase.co/functions/v1/lounge-core-xtream";
const PUBLIC_HOST = "connect.loungetv.nz";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(UPSTREAM + incoming.pathname);

    for (const [key, value] of incoming.searchParams) {
      if (key !== "_lounge_host") target.searchParams.append(key, value);
    }
    target.searchParams.set("_lounge_host", PUBLIC_HOST);

    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", PUBLIC_HOST);
    headers.set("X-Forwarded-Proto", "https");

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    const upstream = await fetch(target.toString(), init);
    const responseHeaders = new Headers(upstream.headers);

    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("X-Content-Type-Options", "nosniff");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
