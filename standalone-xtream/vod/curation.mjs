const DAY = 86_400_000;
const RECENT_RELEASE_DAYS = 180;
const RECENT_ADDITION_DAYS = 30;
const MIN_RATING_VOTES = 100;
const FEATURED_LIMIT = 150;
const MIN_CATEGORY_SIZE = 3;

const genres = (...names) => row => names.some(name => row.genres.includes(name));
const byNumber = field => (a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0);

const movies = [
  [1, "New Releases", row => row.recentRelease, byNumber("releaseTime")],
  [2, "Recently Added", row => row.recentAddition, byNumber("addedTime")],
  [3, "Popular Movies", row => row.popularity > 0, byNumber("popularity")],
  [4, "Top Rated Movies", row => row.votes >= MIN_RATING_VOTES && row.rating > 0, byNumber("rating")],
  [5, "4K Ultra HD", row => row.verifiedUhd, byNumber("releaseTime")],
  [6, "Movie Collections", row => row.collection, (a, b) =>
    a.collection.localeCompare(b.collection) || Number(a.collection_order ?? Infinity) - Number(b.collection_order ?? Infinity)],
  [7, "Family", genres("Family")],
  [8, "Animation", genres("Animation")],
  [9, "Action & Adventure", genres("Action", "Adventure")],
  [10, "Comedy", genres("Comedy")],
  [11, "Crime", genres("Crime")],
  [12, "Drama", genres("Drama")],
  [13, "Science Fiction & Fantasy", genres("Science Fiction", "Fantasy")],
  [14, "Romance", genres("Romance")],
  [15, "Documentaries", genres("Documentary")],
  [16, "Biography & History", genres("History", "Biography")],
  [17, "War", genres("War")],
  [18, "Western", genres("Western")],
  [19, "Music & Musicals", genres("Music", "Musical")],
  [20, "Thriller & Mystery", genres("Thriller", "Mystery")],
  [21, "Horror", genres("Horror")],
];

const series = [
  [1, "Latest Series", row => row.recentRelease, byNumber("releaseTime")],
  [2, "Recently Added", row => row.recentAddition, byNumber("addedTime")],
  [3, "Recently Updated", row => row.recentEpisode, byNumber("episodeTime")],
  [4, "Popular Series", row => row.popularity > 0, byNumber("popularity")],
  [5, "Top Rated Series", row => row.votes >= MIN_RATING_VOTES && row.rating > 0, byNumber("rating")],
  [6, "Kids & Family", genres("Kids", "Family")],
  [7, "Animation", genres("Animation")],
  [8, "Action & Adventure", genres("Action & Adventure", "Action", "Adventure")],
  [9, "Comedy", genres("Comedy")],
  [10, "Sitcoms", row => row.format === "Sitcom" || row.genres.includes("Sitcom")],
  [11, "Drama", genres("Drama")],
  [12, "Crime & Mystery", genres("Crime", "Mystery")],
  [13, "Science Fiction & Fantasy", genres("Sci-Fi & Fantasy", "Science Fiction", "Fantasy")],
  [14, "Reality TV", genres("Reality")],
  [15, "Documentaries", genres("Documentary")],
  [16, "Lifestyle", genres("Lifestyle", "Food", "Travel", "Home & Garden")],
  [17, "History & War", genres("History", "War", "War & Politics")],
  [18, "Miniseries", row => ["Miniseries", "Mini Series", "Limited Series"].includes(row.format)],
  [19, "Thriller", genres("Thriller")],
  [20, "Horror", genres("Horror")],
];

function timestamp(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function unixTimestamp(value) {
  return String(Math.floor(value / 1000));
}

export function buildVodCatalogue(kind, sourceRows, now = Date.now()) {
  const isMovie = kind === "movie";
  const definitions = isMovie ? movies : series;
  const firstGenre = isMovie ? 7 : 6;
  const idBase = isMovie ? 2810100 : 2820100;
  const recent = (time, days) => time > now - days * DAY && time <= now;
  const defaultOrder = (a, b) =>
    Number(b.primary_audio_language === "en") - Number(a.primary_audio_language === "en") ||
    byNumber("releaseTime")(a, b) ||
    a.display_name.localeCompare(b.display_name) ||
    Number(a.external_id) - Number(b.external_id);
  const rows = [];
  const identities = new Set();
  for (const source of sourceRows) {
    const id = Number(source.external_id);
    if (!Number.isSafeInteger(id) || id < 1 || identities.has(id)) continue;
    identities.add(id);
    const releaseTime = timestamp(source.release_date);
    const addedTime = timestamp(source.first_seen_at);
    const episodeTime = timestamp(source.latest_episode_added_at);
    rows.push({
      ...source,
      genres: source.genres || [],
      releaseTime,
      addedTime,
      episodeTime,
      recentRelease: recent(releaseTime, RECENT_RELEASE_DAYS),
      recentAddition: recent(addedTime, RECENT_ADDITION_DAYS),
      recentEpisode: recent(episodeTime, RECENT_ADDITION_DAYS),
      verifiedUhd: source.runtime_verified === true && Number(source.resolution_height) >= 2160,
    });
  }
  rows.sort(defaultOrder);

  const categories = [];
  const members = new Map();
  const memberships = new Map();
  function addCategory(order, name, matching) {
    const categoryId = String(idBase + order);
    categories.push({ category_id: categoryId, category_name: name, parent_id: 0 });
    members.set(categoryId, matching);
    for (const row of matching) {
      const id = Number(row.external_id);
      const previous = memberships.get(id) || [];
      // A genre remains the primary Xtream category. Featured rows have membership too.
      if (order >= firstGenre && !previous.some(value => value >= idBase + firstGenre)) {
        previous.unshift(Number(categoryId));
      } else {
        previous.push(Number(categoryId));
      }
      memberships.set(id, previous);
    }
  }

  for (const [order, name, matches, sort] of definitions) {
    let matching = rows.filter(matches);
    if (sort) matching = matching.sort((a, b) => sort(a, b) || defaultOrder(a, b));
    if (order < firstGenre && name !== "Movie Collections") matching = matching.slice(0, FEATURED_LIMIT);
    if (matching.length >= MIN_CATEGORY_SIZE) addCategory(order, name, matching);
  }

  return { categories, rows, members, memberships };
}

export function vodCatalogueRows(catalogue, requestedCategory) {
  const rows = requestedCategory === null ? catalogue.rows : catalogue.members.get(requestedCategory) || [];
  return rows.map((row, index) => {
    const categoryIds = catalogue.memberships.get(Number(row.external_id)) || [];
    const rating = Number(row.rating) > 0 ? Number(row.rating) : "";
    return {
      ...row,
      position: index + 1,
      category_id: requestedCategory || String(categoryIds[0] || 0),
      category_ids: categoryIds,
      rating,
      rating_5based: rating === "" ? "" : rating / 2,
      added: unixTimestamp(row.addedTime),
      last_modified: unixTimestamp(row.episodeTime),
    };
  });
}
