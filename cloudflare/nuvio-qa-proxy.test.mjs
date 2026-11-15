import assert from "node:assert/strict";
import test from "node:test";
import worker from "./nuvio-qa-proxy.mjs";

async function call(path, options = {}) {
  let forwarded;
  globalThis.fetch = async request => {
    forwarded = request;
    if (path.startsWith("/n/live/")) {
      return new Response(null, { status: 302, headers: { Location: "https://example.invalid/live/source.ts" } });
    }
    return new Response(JSON.stringify({ user_info: { auth: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const response = await worker.fetch(new Request("https://connect.loungetv.nz" + path, options));
  return { forwarded, response };
}

test("QA root is routed to the n Edge Function", async () => {
  const { forwarded, response } = await call("/n");
  assert.equal(response.status, 200);
  const url = new URL(forwarded.url);
  assert.equal(url.pathname, "/functions/v1/n");
  assert.equal(url.searchParams.get("_lounge_host"), "connect.loungetv.nz/n");
});
test("Xtream player_api credentials and action survive proxying", async () => {
  const { forwarded } = await call("/n/player_api.php?username=qa-user&password=qa-pass&action=get_live_categories");
  const url = new URL(forwarded.url);
  assert.equal(url.pathname, "/functions/v1/n/player_api.php");
  assert.equal(url.searchParams.get("username"), "qa-user");
  assert.equal(url.searchParams.get("password"), "qa-pass");
  assert.equal(url.searchParams.get("action"), "get_live_categories");
});
test("M3U and XMLTV routes survive without a redirect", async () => {
  for (const path of ["/n/get.php?type=m3u_plus", "/n/xmltv.php?username=qa-user"]) {
    const { forwarded, response } = await call(path);
    assert.equal(response.status, 200);
    assert.equal(new URL(forwarded.url).pathname, "/functions/v1" + path);
  }
});
test("Live playback preserves range headers and 302 redirects", async () => {
  const { forwarded, response } = await call("/n/live/user/pass/2000123456.ts", {
    headers: { Range: "bytes=0-1023" },
  });
  assert.equal(forwarded.headers.get("range"), "bytes=0-1023");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://example.invalid/live/source.ts");
});
test("Unrelated paths must never be forwarded", async () => {
  const { forwarded, response } = await call("/nonsense");
  assert.equal(response.status, 404);
  assert.equal(forwarded, undefined);
});
test("Proxy responses must never be cached", async () => {
  const { response } = await call("/n/player_api.php");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-lounge-qa-route"), "n");
});
