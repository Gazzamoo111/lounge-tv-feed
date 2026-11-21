import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const curated = Array.from({ length: 9 }, (_, i) => ({
  external_id: 100 + i, provider_stream_id: 636918 + i, provider_name: "BEST",
  category: "New Zealand", subcategory: "Sports", display_name: "SKY SPORT " + (i + 1),
  epg_id: "SkySport" + (i + 1) + ".nz", source_format: "ts",
}));
const other = {
  external_id: 110, provider_stream_id: 720001, provider_name: "BEST",
  category: "Australia", display_name: "Fixture AU", source_format: "ts",
};
curated.push(other);

const inventory = curated.slice(0, 9).map(row => ({
  provider_item_id: row.provider_stream_id, name: "NZ| " + row.display_name + " HD",
  provider_group: row.external_id === 101 ? "NZ| SKY SPORTS NZ" : "NZ| NEW ZEALAND",
  is_adult: false,
}));
inventory.push({ provider_item_id: 720002, name: "AU| Fixture Raw", provider_group: "AU| SPORT" });

async function sql(parts, ...params) {
  const query = parts.join("?");
  if (query.includes("legacy_xtream_auth_cache")) return [];
  if (query.includes("lounge_delivery.catalogue_releases")) return [{ id: "fixture", release_key: "fixture" }];
  if (query.includes("lounge_delivery.shared_epg_channels")) return [];
  if (query.includes("where i.item_kind='live' and i.external_id=")) {
    return curated.filter(row => row.external_id === params.at(-1));
  }
  if (query.includes("order by l.sort_order,i.external_id")) return curated;
  assert.fail("Unexpected fixture query");
}

sql.unsafe = async query => {
  if (query.includes("lounge_plus_route_account_sha256")) return [];
  if (query.includes("lounge_sync.best_inventory_items")) return inventory;
  assert.fail("Unexpected fixture query");
};

for (const [profile, slug] of [["n", "n"], ["plus", "lounge-plus-qa"]]) {
  test(profile + ": actual handler exposes backups and only opts Sky Sport NZ into HLS", async t => {
    const provider = "https://provider.invalid";
    const base = "https://gateway.invalid/functions/v1/" + slug;
    let handler;
    t.mock.method(globalThis, "fetch", async target => {
      const url = new URL(target);
      assert.equal(url.origin + url.pathname, provider + "/player_api.php");
      return Response.json({ user_info: { auth: 1, status: "Active" } });
    });
    const settings = {
      SUPABASE_DB_URL: "postgres://db.invalid/fixture",
      SUPABASE_URL: "https://gateway.invalid",
      LOUNGE_BEST_BASE: provider,
    };
    globalThis.Deno = {
      env: { get: name => settings[name] },
      serve: callback => { handler = callback; },
    };
    globalThis.skySportFixtureSql = sql;
    const hook = registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === "npm:postgres@3.4.7") {
          return nextResolve("data:text/javascript,export default () => globalThis.skySportFixtureSql", context);
        }
        return nextResolve(specifier, context);
      },
    });
    t.after(() => {
      hook.deregister();
      delete globalThis.Deno;
      delete globalThis.skySportFixtureSql;
    });
    await import("../production/" + profile + "/index.ts");

    const request = path => handler(new Request(base + path));
    const response = await request("/get.php?username=fixture&password=fixture");
    assert.equal(response.status, 200);
    const playlist = await response.text();
    const backups = playlist.match(/,SKY SPORT [1-9] HD BACKUP\n/g) || [];
    assert.equal(backups.length, profile === "plus" ? 7 : 9);
    assert.match(playlist, /tvg-id="SkySport2\.nz"[^\n]+,SKY SPORT 2 HD BACKUP\n/);

    async function expectRedirect(id, requestedFormat, providerId, format) {
      const redirect = await request("/live/fixture/fixture/" + id + "." + requestedFormat);
      assert.equal(redirect.status, 302);
      assert.equal(redirect.body, null);
      assert.equal(redirect.headers.get("Location"), provider + "/live/fixture/fixture/" + providerId + "." + format);
    }
    const sky2 = profile === "plus" ? 1424317 : 2024777;
    await expectRedirect(101, "ts", sky2, "ts");
    await expectRedirect(101, "m3u8", sky2, "m3u8");
    await expectRedirect(2000636919, "ts", 636919, "ts");
    await expectRedirect(2000636919, "M3U8", 636919, "m3u8");
    await expectRedirect(110, "m3u8", 720001, "ts");
    await expectRedirect(2000720002, "m3u8", 720002, "ts");
  });
}
