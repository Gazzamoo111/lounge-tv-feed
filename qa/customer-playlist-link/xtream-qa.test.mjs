import assert from "node:assert/strict";
import { test } from "node:test";
import { createXtreamQaHandler } from "./xtream-qa.mjs";
import directEpg from "./direct-epg.json" with { type: "json" };

const base = "https://liqocisegeqzbyuqloql.supabase.co/functions/v1/lounge-xtream-direct-epg-qa";
const login = new URLSearchParams({ username: "qa+user", password: "qa&pass" });
const request = (path, params = "") => new Request(`${base}${path}?${login}${params}`);
const plus = { "X-Lounge-Catalogue": "plus-qa" };
const guide = `https://n.loungetv.nz/xmltv.php?${login}`;
const drm = [1, 2].map(n => [
  `#EXTINF:-1 channel-id="ltv-${n}" tvg-id="TVNZ${n}.nz" group-title="01 NZ &amp; AU",TVNZ ${n}`,
  "#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha",
  `#KODIPROP:inputstream.adaptive.license_key=https://example.test/license?ch=${n}`,
  `https://example.test/tvnz-${n}.mpd`,
]).flat();
const media = "https://n.loungetv.nz/live/qa%2Buser/qa%26pass/700.ts";

test("rewrites only the fallback guide header, matching EPG IDs and escaped group labels", async () => {
  const source = [
    `#EXTM3U x-tvg-url="${guide}"`,
    ...drm,
    '#EXTINF:-1 channel-id="ltv-700" tvg-id="10Bold.au" tvg-logo="logo?a=1&amp;b=2" group-title="AU, News &amp; Sport",10 Bold, AU',
    media,
    '#EXTINF:-1 channel-id="ltv-2000646976" tvg-id="changed.au" group-title="AU &amp; NZ",Changed ID',
    media.replace("700.ts", "2000646976.ts"),
    "",
  ].join("\r\n");
  const handler = createXtreamQaHandler(async (url, options) => {
    assert.equal(url.origin, "https://n.loungetv.nz");
    assert.equal(url.pathname, "/get.php");
    assert.equal(url.searchParams.toString(), login + "&type=m3u_plus&output=ts");
    assert.equal(options.redirect, "error");
    return new Response(source, { headers: { ...plus, "Content-Type": "application/x-mpegURL" } });
  });
  const result = await handler(request("/get.php", "&type=m3u_plus&output=ts&_lounge_host=untrusted.example"));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("X-Lounge-QA-EPG-Remaps"), "1");
  const expectedHeader = [guide, ...directEpg.guides].join(",");
  assert.equal(await result.text(), source.replace(guide, expectedHeader)
    .replaceAll(/(group-title="[^"]*)&amp;/g, "$1&")
    .replace('tvg-id="10Bold.au"', 'tvg-id="10bold.au"'));
});

test("preserves Xtream 503 and account responses, guide bytes, category IDs and order", async () => {
  const categories = [
    { category_id: "12", category_name: "NZ &amp; AU" },
    { category_id: "1", category_name: "Kids & Family" },
  ];
  const fallback = '{"error":"nuvio_m3u_drm_fallback_required"}';
  const xml = '<?xml version="1.0"?><tv><channel id="test"/></tv>';
  const handler = createXtreamQaHandler(async url => {
    assert.equal(url.searchParams.get("username"), "qa+user");
    assert.equal(url.searchParams.get("password"), "qa&pass");
    if (url.pathname === "/xmltv.php") {
      return new Response(xml, { headers: { ...plus, "Content-Type": "application/xml" } });
    }
    assert.equal(url.pathname, "/player_api.php");
    switch (url.searchParams.get("action")) {
      case "get_live_categories":
        return Response.json(categories, { headers: plus });
      case "get_live_streams":
        return new Response(fallback, { status: 503, headers: plus });
      default:
        return Response.json({ user_info: { auth: 1 } }, { headers: plus });
    }
  });
  assert.deepEqual(await (await handler(request("/"))).json(), { user_info: { auth: 1 } });
  const streams = await handler(request("/player_api.php", "&action=get_live_streams"));
  assert.equal(streams.status, 503);
  assert.equal(await streams.text(), fallback);
  const groups = await handler(request("/player_api.php", "&action=get_live_categories"));
  assert.deepEqual(await groups.json(), [{ ...categories[0], category_name: "NZ & AU" }, categories[1]]);
  assert.equal(await (await handler(request("/xmltv.php"))).text(), xml);
});

test("rejects missing credentials, non-Plus responses and unsupported paths", async () => {
  let requests = 0;
  const handler = createXtreamQaHandler(async () => {
    requests++;
    return Response.json({ user_info: { auth: 1 } });
  });
  assert.equal((await handler(new Request(base + "/get.php"))).status, 401);
  assert.equal((await handler(new Request("https://example.test/lounge-xtream-direct-epg-qa/get.php"))).status, 401);
  assert.equal((await handler(request("/live/qa/qa/700.ts"))).status, 404);
  assert.equal((await handler(request("/player_api.php", "&action=get_vod_streams"))).status, 404);
  assert.equal((await handler(request("/get.php"))).status, 401);
  assert.equal(requests, 1);
});
