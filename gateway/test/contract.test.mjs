import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCategory,
  formatLive,
  formatMovie,
  formatSeries,
  playbackPath,
  xmlEscape,
} from "../src/index.js";

test("clean category shape", () => {
  assert.deepEqual(formatCategory({
    category_id: 7,
    category_name: "Sports",
  }), {
    category_id: "7",
    category_name: "Sports",
    parent_id: 0,
  });
});

test("live responses never expose provider source metadata", () => {
  const row = formatLive({
    item_id: 101,
    name: "ESPN",
    icon_url: "https://img.example/espn.png",
    epg_id: "espn.us",
    category_id: 2,
    snapshot: {
      provider_username: "SHOULD_NOT_LEAK",
      provider_password: "SHOULD_NOT_LEAK",
      server_url: "SHOULD_NOT_LEAK",
    },
  });

  const encoded = JSON.stringify(row);
  assert.equal(encoded.includes("SHOULD_NOT_LEAK"), false);
  assert.equal(row.direct_source, "");
});

test("movie format uses Lounge metadata only", () => {
  const row = formatMovie({
    item_id: 202,
    name: "Example Movie",
    icon_url: "https://img.example/movie.jpg",
    rating: 8,
    category_id: 4,
    container_extension: "mkv",
    snapshot: { added: "1" },
  });
  assert.equal(row.name, "Example Movie");
  assert.equal(row.stream_id, 202);
  assert.equal(row.rating_5based, 4);
  assert.equal(row.direct_source, "");
});

test("series format carries premium artwork", () => {
  const row = formatSeries({
    item_id: 303,
    name: "Example Series",
    icon_url: "https://img.example/poster.jpg",
    backdrop_url: "https://img.example/backdrop.jpg",
    plot: "Plot",
    rating: 7.5,
    category_id: 5,
    snapshot: {},
  });
  assert.deepEqual(row.backdrop_path, ["https://img.example/backdrop.jpg"]);
  assert.equal(row.series_id, 303);
});

test("playback URL is Lounge-facing", () => {
  assert.equal(
    playbackPath("live","customer","password",55,"ts"),
    "/live/customer/password/55.ts",
  );
  assert.equal(
    playbackPath("episode","customer","password",77,"mp4"),
    "/series/customer/password/77.mp4",
  );
});

test("XML escapes metadata", () => {
  assert.equal(xmlEscape('A & B < "C"'), "A &amp; B &lt; &quot;C&quot;");
});
