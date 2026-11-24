import test from "node:test";
import assert from "node:assert/strict";
import { buildVodCatalogue, vodCatalogueRows } from "../production/n/vod-catalogue.mjs";

const now = Date.parse("2026-11-24T08:00:00Z");
const date = "2026-11-01";
const film = (id, extras = {}) => ({
  external_id: id,
  display_name: "Film " + id,
  genres: ["Family", "Animation", "Thriller", "Horror"],
  release_date: date,
  ...extras,
});

test("keeps one row per stable title with featured and genre membership", () => {
  const data = buildVodCatalogue("movie", [film(1), film(2), film(3), film(1)], now);
  assert.deepEqual(data.categories.map(row => row.category_name), [
    "New Releases", "Family", "Animation", "Thriller & Mystery", "Horror",
  ]);
  const all = vodCatalogueRows(data, null);
  const featured = vodCatalogueRows(data, "2810101");
  assert.equal(all.length, 3);
  assert.deepEqual(all.map(row => row.external_id), featured.map(row => row.external_id));
  assert.equal(all[0].category_id, "2810107");
  assert.equal(featured[0].category_id, "2810101");
  assert.deepEqual(all[0].category_ids, [2810107, 2810101, 2810108, 2810120, 2810121]);
});

test("dates, vote thresholds and runtime-confirmed 4K govern feature membership", () => {
  const rows = [1, 2, 3].map(id => film(id, {
    release_date: "1995-01-01", first_seen_at: date,
    rating: 9, votes: 99, resolution_height: 2160, runtime_verified: true,
  }));
  rows.push(film(4, { release_date: "2026-12-01", resolution_height: 2160 }));
  const data = buildVodCatalogue("movie", rows, now);
  const categories = data.categories.map(row => row.category_name);
  assert.ok(categories.includes("Recently Added"));
  assert.ok(categories.includes("4K Ultra HD"));
  assert.ok(!categories.includes("Top Rated Movies"));
  assert.ok(!categories.includes("New Releases"));
  assert.ok(!categories.includes("Classics"));
  assert.ok(!vodCatalogueRows(data, "2810105").some(row => row.external_id === 4));
  assert.deepEqual(vodCatalogueRows(data, "123456"), []);
});

test("series prioritizes family and animation, then ends with thriller and horror", () => {
  const rows = [1, 2, 3].map(id => film(id, {
    genres: ["Kids", "Animation", "Thriller", "Horror"],
    release_date: "2020-01-01", latest_episode_added_at: date,
  }));
  const data = buildVodCatalogue("series", rows, now);
  assert.deepEqual(data.categories.map(row => row.category_name), [
    "Recently Updated", "Kids & Family", "Animation", "Thriller", "Horror",
  ]);
  assert.equal(vodCatalogueRows(data, "2820103").length, 3);
});

test("catalogue-wide results retain unclassified titles without making a false genre", () => {
  const data = buildVodCatalogue("movie", [film(1, { genres: [], release_date: null })], now);
  assert.deepEqual(data.categories, []);
  assert.equal(vodCatalogueRows(data, null)[0].category_id, "0");
});
