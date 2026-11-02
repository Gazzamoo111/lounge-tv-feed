import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/index.js";

const env = {
  SUPABASE_URL: "https://supabase.example",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  CATALOGUE_RELEASE_KEY: "lounge-universal-staging-v1",
};

function response(data, status = 200, headers = {}) {
  return new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("Xtream auth returns Lounge server identity and no upstream credentials", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/rpc/lounge_delivery_authenticate")) {
      return response({
        ok: true,
        status: "active",
        user_id: "00000000-0000-0000-0000-000000000001",
        release_id: "00000000-0000-0000-0000-000000000002",
        release_key: "lounge-universal-staging-v1",
        max_connections: 1,
        live_count: 2391,
        movie_count: 5142,
        series_count: 3395,
      });
    }
    throw new Error("unexpected fetch " + url);
  };

  try {
    const req = new Request("https://staging.example/player_api.php?username=loungeuser&password=loungepass");
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user_info.auth, 1);
    assert.equal(body.server_info.url, "staging.example");
    const encoded = JSON.stringify(body);
    assert.equal(encoded.includes("supabase.example"), false);
    assert.equal(encoded.includes("service-role-test"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("released Live list exposes only Lounge metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/rpc/lounge_delivery_authenticate")) {
      return response({
        ok: true,
        status: "active",
        user_id: "00000000-0000-0000-0000-000000000001",
        release_id: "00000000-0000-0000-0000-000000000002",
        release_key: "lounge-universal-staging-v1",
        max_connections: 1,
        live_count: 2391,
        movie_count: 5142,
        series_count: 3395,
      });
    }
    if (url.endsWith("/rpc/lounge_delivery_list_items")) {
      return response([{
        item_id: 1001,
        canonical_id: "00000000-0000-0000-0000-000000000003",
        name: "ESPN",
        icon_url: "https://images.example/espn.png",
        epg_id: "espn.us",
        container_extension: "ts",
        category_id: 12,
        snapshot: {},
      }]);
    }
    throw new Error("unexpected fetch " + url);
  };

  try {
    const req = new Request("https://staging.example/player_api.php?username=loungeuser&password=loungepass&action=get_live_streams&category_id=12");
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 1);
    assert.equal(body[0].name, "ESPN");
    assert.equal(body[0].direct_source, "");
    assert.equal(Object.hasOwn(body[0], "provider_stream_id"), false);
    assert.equal(Object.hasOwn(body[0], "provider_username"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HOLD or DROP cannot play unless present in the release snapshot", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/rpc/lounge_delivery_authenticate")) {
      return response({
        ok: true,
        status: "active",
        user_id: "00000000-0000-0000-0000-000000000001",
        release_id: "00000000-0000-0000-0000-000000000002",
        release_key: "lounge-universal-staging-v1",
        max_connections: 1,
      });
    }
    if (url.endsWith("/rpc/lounge_delivery_resolve_source")) {
      return response({ message: "catalogue item unavailable" }, 400);
    }
    throw new Error("unexpected fetch " + url);
  };

  try {
    const req = new Request("https://staging.example/movie/loungeuser/loungepass/999999.mp4");
    const res = await handleRequest(req, env);
    assert.equal(res.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
