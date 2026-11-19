import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const [source, output] = process.argv.slice(2);
const origin = "https://edge.invalid";
const best = "https://provider.invalid";
const standard = ["offline-standard", "sample-only"];
const plus = ["offline-plus", "sample-only"];
const rows = [];
function channel(name, category, providerId, guide, provider = "BEST", subcategory = "") {
  rows.push({
    external_id: 100 + rows.length, display_name: name, category, subcategory,
    provider_stream_id: providerId, provider_name: provider, epg_id: guide,
    logo_url: guide ? "https://art.invalid/channel.png" : "",
    source_format: "ts", sort_order: rows.length,
  });
}
channel("TVNZ 1", "New Zealand", 900000001, "TVNZ1.nz", "MJH NZ");
channel("TVNZ 2", "New Zealand", 900000002, "TVNZ2.nz", "MJH NZ");
channel("Three", "New Zealand", 900000003, "Three.nz", "MJH NZ");
channel("Whakaata Māori", "New Zealand", 900000004, "Maori.nz", "MJH NZ");
channel("Te Reo", "New Zealand", 900000005, "TeReo.nz", "MJH NZ");
for (let number = 1; number <= 9; number++) {
  channel("Sky Sport " + number, "New Zealand", 636917 + number, "SkySport" + number + ".nz");
}
channel("Example Seven Sydney", "Australia", 701, "Seven.Sydney.au");
channel("Example Seven Melbourne", "Australia", 702, "Seven.Melbourne.au");
channel("Example Sport", "Sports", 703, "ExampleSports.au");
channel("Example UK", "Entertainment", 704, "Example.uk", "BEST", "UK");
channel("Example UK Variant", "Entertainment", 711, "Example.uk", "BEST", "UK");
channel("Example US Variant", "Entertainment", 712, "Example.us", "BEST", "US");
channel("Example US", "Entertainment", 705, "Example.us", "BEST", "US");
channel("Example Movies", "Movies", 706, "MissingGuide.example");
channel("Example Kids", "Kids & Family", 707, "");
channel("Example Repeat Movie", "24/7", 709, "", "BEST", "MOVIES / ACTORS");
channel("Example Repeat Comedy", "24/7", 710, "", "BEST", "COMEDY");
channel("Example Event", "PPV", 708, "");
const internationalInventory = [
  { provider_item_id: 801, name: "FR | Example French", provider_group: "FR | FRANCE", epg_channel_id: "Example.fr" },
  { provider_item_id: 802, name: "IN | Example India", provider_group: "IN | INDIA", epg_channel_id: "Example.in" },
];
const guideIds = [...new Set([
  ...rows.filter(row => row.epg_id && row.provider_stream_id !== 706).map(row => row.epg_id),
  ...internationalInventory.map(row => row.epg_channel_id),
])];
function guideParts(ids) {
  return ids.map(id => [
    `<channel id="${id}"><display-name>Example</display-name></channel>`,
    `<programme channel="${id}" start="20300102003000 +1300" stop="20300102013000 +1300"><title>Example current</title></programme>`,
    `<programme channel="${id}" start="20300101123000 +0000" stop="20300101133000 +0000"><title>Example next</title></programme>`,
  ].slice(0, id === "Example.us" ? 1 : id === "Seven.Sydney.au" ? 2 : 3).join("\n")).join("\n");
}
function guide(ids) {
  return `<?xml version="1.0"?><tv>${guideParts(ids)}</tv>`;
}

const calls = [];
const unexpected = [];
function reject(kind) {
  unexpected.push(kind);
  throw new Error("Unexpected mocked dependency");
}
const digest = Buffer.from(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(plus.join("\0")),
)).toString("hex");
async function sql(parts, ...values) {
  const query = parts.join("?").toLowerCase();
  if (query.includes("legacy_xtream_auth_cache")) return [];
  if (query.includes("catalogue_releases")) return [{ id: "10000000-0000-4000-8000-000000000001", release_key: "offline" }];
  if (query.includes("international_master_streams_qa")) return structuredClone(internationalInventory);
  if (query.includes("international_epg_matches_qa")) return [];
  if (query.includes("from lounge_delivery.live_release_items")) return structuredClone(rows);
  if (query.includes("from lounge_delivery.item_ids") && query.includes("live_source_bindings")) {
    return structuredClone(rows.filter(row => row.external_id === values.at(-1)));
  }
  if (query.includes("select xmltv from lounge_delivery.shared_epg_channels")) {
    return [{ xmltv: guideParts(values[0]) }];
  }
  if (query.includes("from lounge_delivery.shared_epg_channels") && query.includes("select epg_id")) {
    return guideIds.filter(id => !Array.isArray(values[0]) || values[0].includes(id)).map(epg_id => ({ epg_id }));
  }
  if (query.includes("release_vod_items") || query.includes("vod_release_items")) return [];
  return reject("SQL query");
}
sql.unsafe = async query => {
  if (query.includes("lounge_plus_route_account_sha256")) return [{ digest }];
  if (query.includes("best_inventory_items")) return [];
  return reject("SQL unsafe query");
};

globalThis.offlineSql = sql;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("npm:postgres@")) {
      return { url: "data:text/javascript,export default () => globalThis.offlineSql", shortCircuit: true };
    }
    if (!specifier.startsWith("file:")) assert.match(specifier, /^\.{1,2}\//, "Gateway imports must use the recovered local bundle");
    return next(specifier, context);
  },
});
const env = {
  SUPABASE_DB_URL: "postgres://offline:offline@db.invalid/offline",
  SUPABASE_URL: origin, LOUNGE_BEST_BASE: best,
  SUPABASE_SERVICE_ROLE_KEY: "offline-role",
};
const handlers = {};
for (const slug of ["n", "lounge-plus-qa", "lounge-international-regional-qa"]) {
  globalThis.Deno = { env: { get: key => env[key] }, serve: handler => { handlers[slug] = handler; } };
  // The entrypoint and its local imports are the only code under test.
  await import(pathToFileURL(resolve(source, slug, "index.ts")).href);
  assert.equal(typeof handlers[slug], "function");
}
let guideMode = "normal";
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin === origin && url.pathname.startsWith("/functions/v1/lounge-plus-qa/")) {
    calls.push({ delegated: true, path: url.pathname.split("/")[4], host: url.searchParams.get("_lounge_host") });
    return handlers["lounge-plus-qa"](new Request(url, options));
  }
  if (url.origin === best && url.pathname === "/player_api.php") {
    const allowed = [standard, plus].some(([user, password]) =>
      user === url.searchParams.get("username") && password === url.searchParams.get("password"));
    return Response.json({ user_info: { auth: Number(allowed), status: allowed ? "Active" : "Disabled" } });
  }
  if (url.origin === origin && url.pathname.startsWith("/storage/v1/object/authenticated/")) {
    return guideMode === "fallback" ? new Response(null, { status: 404 })
      : new Response(gzipSync(guide(guideIds)));
  }
  if (url.origin === origin && url.pathname === "/functions/v1/lounge-core-live-xmltv") {
    return guideMode === "fallback" ? new Response(null, { status: 502 }) : new Response(guide(guideIds));
  }
  if (url.origin === best && url.pathname === "/xmltv.php" && guideMode === "fallback") {
    calls.push({ providerGuide: true });
    return new Response(guide(guideIds));
  }
  return reject("fetch");
};

const profiles = [
  ["nz-au", "n", standard], ["plus", "n", plus],
  ["regional-v4", "lounge-international-regional-qa", standard],
];
function request(slug, account, path, action) {
  const url = new URL(origin + "/functions/v1/" + slug + "/" + path);
  if (account) {
    url.searchParams.set("username", account[0]);
    url.searchParams.set("password", account[1]);
  }
  if (action) url.searchParams.set("action", action);
  return handlers[slug](new Request(url));
}
for (const [profile, slug, account] of profiles) {
  const dir = resolve(output, profile);
  mkdirSync(dir, { recursive: true });
  async function capture(filename, response, status) {
    assert.equal(response.status, status, profile + " " + filename);
    writeFileSync(resolve(dir, filename), await response.text());
  }
  const start = calls.length;
  await capture("categories.json", await request(slug, account, "player_api.php", "get_live_categories"), 200);
  await capture("streams.json", await request(slug, account, "player_api.php", "get_live_streams"), 503);
  const playlist = await request(slug, account, "get.php");
  const body = await playlist.clone().text();
  const entries = body.split("#EXTINF:").slice(1);
  for (const number of [1, 2]) {
    const entry = entries.find(text => text.includes('channel-id="ltv-' + (99 + number) + '"')) || "";
    assert.ok(entry.includes("#KODIPROP:inputstream.adaptive.manifest_type=mpd"), "TVNZ DASH manifest");
    assert.ok(entry.includes("#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha"), "TVNZ Widevine");
    const licence = entry.split("\n").find(line => line.startsWith("#KODIPROP:inputstream.adaptive.license_key="));
    assert.ok(licence, "TVNZ licence directive");
    const target = new URL(licence.slice(licence.indexOf("=") + 1));
    assert.equal(target.pathname.split("/").at(-1), "tvnz-license-qa", "TVNZ authorised licence route");
    assert.equal(target.searchParams.get("ch"), String(number), "TVNZ licence channel");
    assert.ok(entry.trimEnd().endsWith("/tvnz-" + number + ".mpd"), "TVNZ authorised stream format and channel");
  }
  await capture("playlist.m3u", playlist, 200);
  const visible = new Set(entries.map(entry => /channel-id="([^"]+)"/.exec(entry)?.[1]));
  for (const { provider_item_id: id } of internationalInventory) {
    assert.equal(visible.has("ltv-" + (2000000000 + id)), profile === "regional-v4", "Regional inventory isolation");
  }
  const identities = Object.fromEntries(rows.filter(row => visible.has("ltv-" + row.external_id))
    .map(row => {
      const provider = row.provider_name === "BEST" ? row.provider_stream_id : "mjh-" + row.provider_stream_id;
      const annotation = { provider };
      if ([711, 712].includes(provider)) {
        annotation.identity = "Example affiliate";
        annotation.region = row.subcategory;
      }
      return ["ltv-" + row.external_id, annotation];
    }));
  writeFileSync(resolve(dir, "identities.json"), JSON.stringify(identities));
  const primaryGuide = await request(slug, account, "xmltv.php");
  if (profile === "regional-v4") assert.equal(primaryGuide.headers.get("x-lounge-guide-scope"), "compiled-private-qa");
  await capture("guide.xml", primaryGuide, 200);
  const delegated = calls.slice(start);
  assert.deepEqual(delegated, profile === "plus" ? ["player_api.php", "player_api.php", "get.php", "xmltv.php"]
    .map(path => ({ delegated: true, path, host: "n.loungetv.nz" })) : [], profile + " delegation");
}
for (const [profile, slug, account] of [profiles[0], profiles[2]]) {
  guideMode = "fallback";
  const response = await request(slug, account, "xmltv.php");
  assert.equal(response.status, 200);
  if (profile === "regional-v4") assert.equal(response.headers.get("x-lounge-guide-scope"), "selected-qa");
  else assert.deepEqual(calls.at(-1), { providerGuide: true });
  writeFileSync(resolve(output, profile, "fallback.xml"), await response.text());
}
for (const id of [100, 101]) {
  for (const [, slug, account] of profiles) {
    const response = await request(slug, null, "live/" + account.join("/") + "/" + id + ".ts");
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, "drm_client_required");
  }
}
for (let number = 1; number <= 9; number++) {
  const response = await request("n", null, "live/" + standard.join("/") + "/" + (104 + number) + ".ts");
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).pathname.split("/").at(-1), (2024779 - number) + ".ts");
  const regionalSky = new Map([[1, 636918], [2, 1424317], [3, 1424316], [9, 636926]]);
  for (const [, slug, account] of profiles.slice(1)) {
    const routed = await request(slug, null, "live/" + account.join("/") + "/" + (104 + number) + ".ts");
    assert.equal(routed.status, 302);
    assert.equal(new URL(routed.headers.get("location")).pathname.split("/").at(-1),
      (regionalSky.get(number) ?? 2024779 - number) + ".ts");
  }
}
assert.equal((await request("n", null, "live///100.ts")).status, 403);
assert.equal((await request("n", null, "player_api.php", "get_live_streams")).status, 401);
assert.equal((await request("n", [plus[0], "wrong"], "get.php")).status, 403);
const before = calls.length;
assert.equal((await request("n", plus, "movie/" + plus.join("/") + "/123.mp4")).headers.has("x-lounge-catalogue"), false);
assert.equal(calls.length, before, "Plus VOD must stay on the standard gateway");
assert.deepEqual(unexpected, [], "Unmocked dependency calls");
console.log("PASS gateway replay: NZ/AU, Plus, Regional v4, TVNZ 1/2, Sky Sport 1–9, guide fallback and route isolation");
