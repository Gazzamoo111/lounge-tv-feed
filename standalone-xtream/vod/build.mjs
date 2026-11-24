import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildVodCatalogue, vodCatalogueRows } from './curation.mjs';
import { playbackShard } from '../src/vod.mjs';

const positiveId = value => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 999999999999) {
    throw Error('Invalid VOD ID');
  }
  return id;
};
const extension = value => {
  const ext = String(value ?? '').toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) throw Error('Invalid VOD extension');
  return ext;
};
const artwork = value => {
  if (!value) return '';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      [...url.searchParams.keys()].some(key => /token|auth|pass|key|sign|user/i.test(key))) {
    throw Error('Non-public VOD artwork URL');
  }
  return url.href;
};
const cast = row => Array.isArray(row.cast) ? row.cast.map(person =>
  person?.name).filter(Boolean).slice(0, 15).join(', ') : '';

function info(row) {
  return {
    name: row.display_name,
    plot: row.overview || '',
    cast: cast(row),
    rating: row.rating || null,
    mpaa_rating: row.content_rating || '',
    year: row.release_year || null,
    backdrop_path: row.backdrop_url ? [artwork(row.backdrop_url)] : [],
  };
}

function listRow(kind, row) {
  const shared = {
    num: row.position, name: row.display_name, category_id: row.category_id,
    category_ids: row.category_ids, rating: row.rating, rating_5based: row.rating_5based,
  };
  if (kind === 'movie') {
    return {
      ...shared, stream_type: 'movie', stream_id: positiveId(row.external_id),
      stream_icon: artwork(row.poster_url), added: row.added,
      container_extension: extension(row.file_ext), custom_sid: null, direct_source: '',
    };
  }
  return {
    ...shared, ...info(row), series_id: positiveId(row.external_id),
    cover: artwork(row.poster_url), genre: row.genres.join(', '),
    releaseDate: row.release_date || '', last_modified: row.last_modified,
    episode_run_time: String(row.runtime_minutes || ''),
  };
}

function m3uLine(kind, id, ext, name, logo, category) {
  const clean = value => String(value).replace(/[\r\n"<>]/g, ' ').trim();
  return `#EXTINF:-1 tvg-id="ltv-vod-${kind}-${id}" tvg-logo="${clean(logo)}" group-title="${clean(category)}",${clean(name)}\n/${kind}/${id}.${ext}\n`;
}

export async function buildRelease({ movies, series, episodes }, out, now = Date.now()) {
  const counts = { movie: 0, series: 0, episodes: 0 };
  const bySeries = new Map();
  const episodeIds = new Set();
  for (const episode of episodes) {
    const id = positiveId(episode.external_id);
    const parent = positiveId(episode.series_external_id);
    if (episodeIds.has(id)) throw Error('Duplicate episode ID');
    episodeIds.add(id);
    if (!bySeries.has(parent)) bySeries.set(parent, []);
    bySeries.get(parent).push(episode);
  }
  async function save(path, value) {
    const file = join(out, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const playlist = [];
  for (const [kind, rows] of [['movie', movies], ['series', series]]) {
    if (!rows.length) throw Error('Empty approved VOD catalogue');
    const ids = new Set(rows.map(row => positiveId(row.external_id)));
    if (ids.size !== rows.length) throw Error('Duplicate title ID');
    const catalogue = buildVodCatalogue(kind, rows, now);
    counts[kind] = ids.size;
    if (!catalogue.categories.length) throw Error('Empty approved VOD categories');
    await save(`${kind}/categories.json`, catalogue.categories);
    const categories = new Map(catalogue.categories.map(row => [row.category_id, row.category_name]));
    for (const category of [null, ...categories.keys()]) {
      const values = vodCatalogueRows(catalogue, category).map(row => listRow(kind, row));
      await save(`${kind}/list/${category ?? 'all'}.json`, values);
    }
    const sharded = new Map();
    function mapPlayback(id, row) {
      const shard = playbackShard(id);
      const source = { id: positiveId(row.provider_item_id), ext: extension(row.file_ext) };
      if (!sharded.has(shard)) sharded.set(shard, {});
      sharded.get(shard)[id] = source;
      return source.ext;
    }
    for (const row of catalogue.rows) {
      const id = positiveId(row.external_id);
      const [primary] = catalogue.memberships.get(id) ?? [];
      const name = row.display_name;
      const poster = artwork(row.poster_url);
      const group = categories.get(String(primary));
      if (kind === 'movie') {
        const ext = mapPlayback(id, row);
        await save(`movie/detail/${id}.json`, {
          info: { ...info(row), tmdb_id: row.tmdb_id || null, original_name: name,
            movie_image: poster, description: row.overview || '', releasedate: row.release_date || '',
            genre: row.genres.join(', '), duration_secs: Number(row.runtime_minutes || 0) * 60 },
          movie_data: { stream_id: id, name, container_extension: ext, custom_sid: null, direct_source: '' },
        });
        playlist.push(m3uLine(kind, id, ext, name, poster, `Movies | ${group ?? 'All Movies'}`));
        continue;
      }
      const entries = bySeries.get(id);
      if (!entries?.length) throw Error('Series has no mapped episodes');
      const seasons = new Map();
      const episodeLists = {};
      for (const entry of entries.sort((a, b) => a.season_number - b.season_number ||
        a.episode_number - b.episode_number || a.external_id - b.external_id)) {
        const number = Number(entry.season_number);
        const position = Number(entry.episode_number);
        if (!Number.isSafeInteger(number) || number < 0 || !Number.isSafeInteger(position) || position < 1) {
          throw Error('Invalid season or episode number');
        }
        const episodeId = positiveId(entry.external_id);
        const ext = mapPlayback(episodeId, entry);
        if (!seasons.has(number)) seasons.set(number, {
          id: number, season_number: number, name: entry.season_title || `Season ${number}`,
          cover: artwork(entry.season_poster), episode_count: 0,
        });
        seasons.get(number).episode_count++;
        (episodeLists[number] ??= []).push({
          id: String(episodeId), episode_num: position, season: number, title: entry.title || '',
          container_extension: ext, release_date: entry.release_date || null,
          info: { plot: entry.overview || '', movie_image: artwork(entry.still_url) },
        });
        const label = `${name} S${String(number).padStart(2, '0')}E${String(position).padStart(2, '0')}`;
        playlist.push(m3uLine(kind, episodeId, ext, label, poster, `Series | ${group ?? 'All Series'}`));
        counts.episodes++;
      }
      await save(`series/detail/${id}.json`, {
        info: { ...info(row), cover: poster, releaseDate: row.release_date || '',
          expected_episodes: Number(row.expected_episodes || 0), available_episodes: entries.length },
        seasons: [...seasons.values()], episodes: episodeLists,
      });
    }
    for (const [key, value] of sharded) await save(`${kind}/play/${key}.json`, value);
  }
  if (counts.episodes !== episodes.length) throw Error('Episode references a series outside the approved release');
  await save('playlist.m3u', playlist.join(''));
  await save('counts.json', counts);
  return counts;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const [source, out] = process.argv.slice(2);
  if (!source || !out) throw Error('Usage: node build.mjs snapshot.json output-directory');
  const snapshot = JSON.parse(await readFile(source, 'utf8'));
  console.log(JSON.stringify(await buildRelease(snapshot, out)));
}
