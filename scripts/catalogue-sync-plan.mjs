import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

function id(value) {
  const text = String(value);
  if (!/^[1-9]\d{0,9}$/.test(text) || Number(text) > 2147483647) throw new Error('Invalid ID');
  return text;
}

function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 250 ||
      /https?:\/\/|[\u0000-\u001f\u007f]|\{\{/i.test(value)) throw new Error('Invalid display name');
  return value.trim();
}

function index(rows, key) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Empty inventory');
  const result = new Map();
  for (const row of rows) {
    const keyValue = id(row[key]);
    if (result.has(keyValue)) throw new Error('Duplicate ID in inventory');
    result.set(keyValue, row);
  }
  return result;
}

function identity(value) {
  return name(value).normalize('NFKC').toLowerCase()
    .replace(/^(?:uk|us|usa|au|aus|nz)\s*[:|]\s*/, '')
    .replace(/\b(?:uhd|4k|fhd|hd|sd|raw|hevc|h265|h264|1080p|720p|50fps|60fps)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function planCatalogue({
  categories, live, providerCategories, providerStreams, mappings, mode = 'events',
  protectedIds = [], excludedIds = [], maxAdditions = 1000, previous = {}, slot,
}) {
  if (!['events', 'daily'].includes(mode) || !Number.isInteger(maxAdditions) || maxAdditions < 1) {
    throw new Error('Invalid configuration');
  }
  const cats = index(categories, 'category_id');
  const current = index(live, 'stream_id');
  const sourceCats = index(providerCategories, 'category_id');
  const source = index(providerStreams, 'stream_id');
  const eventId = id(mappings.eventTarget);
  if (id(categories.at(-1).category_id) !== eventId ||
      !/event|ppv/i.test(name(cats.get(eventId).category_name))) throw new Error('Event category must be last');

  const protectedSet = new Set(protectedIds.map(id));
  const excluded = new Set(excludedIds.map(id));
  const retired = new Set((previous.retired ?? []).map(id));
  const groupMap = new Map();
  for (const [sourceId, policy] of Object.entries(mappings.groups ?? {})) {
    const upstreamId = id(sourceId);
    const target = id(typeof policy === 'object' ? policy.target : policy);
    if (!cats.has(target)) throw new Error('Unknown target category');
    if (typeof policy === 'object' &&
        (cats.get(target).category_name !== policy.targetName ||
        sourceCats.get(upstreamId)?.category_name !== policy.sourceName)) {
      throw new Error('Approved category identity changed');
    }
    groupMap.set(upstreamId, target);
  }

  const names = new Set();
  const expected = { event: 0, permanent: 0 };
  const present = { event: 0, permanent: 0 };
  for (const [streamId, row] of current) {
    const category = id(row.category_id);
    if (!cats.has(category)) throw new Error('Invalid current category');
    if (category !== eventId) names.add(identity(row.name));
    if (protectedSet.has(streamId)) continue;
    const segment = category === eventId ? 'event' : 'permanent';
    expected[segment]++;
    if (source.has(streamId)) present[segment]++;
  }
  for (const segment of Object.keys(expected)) {
    if (expected[segment] && present[segment] / expected[segment] < 0.85) {
      throw new Error('Provider overlap below 85%; refusing incomplete inventory');
    }
  }

  const additions = [], renames = [], pending = [], missing = [], removals = [], replacements = [];
  const nextMissing = {};
  const groups = new Map();
  for (const [streamId, row] of source) {
    const group = row.category_id == null ? null : id(row.category_id);
    if (group !== null && !sourceCats.has(group)) throw new Error('Unknown provider group');
    const target = groupMap.get(group);
    if (group !== null) groups.set(group, (groups.get(group) ?? 0) + 1);
    if (protectedSet.has(streamId)) continue;

    const old = current.get(streamId);
    if (old) {
      if (target === eventId && id(old.category_id) === eventId) {
        const title = name(row.name);
        if (title !== old.name) renames.push({ stream_id: Number(streamId), name: title });
      } else if (target && target !== id(old.category_id)) {
        replacements.push({ stream_id: Number(streamId), source_category_id: group, reason: 'category_changed' });
      }
      continue;
    }
    if (excluded.has(streamId) && !(retired.has(streamId) && target === eventId)) continue;
    if (!target) {
      pending.push({ stream_id: Number(streamId), source_category_id: group, reason: group === null ? 'missing_provider_group' : 'unmapped_group' });
      continue;
    }
    if (mode === 'events' && target !== eventId) continue;
    const title = name(row.name);
    if (target !== eventId && (names.has(identity(title)) || /\b(?:adult|xxx|unassigned|test channel)\b/i.test(title))) {
      pending.push({ stream_id: Number(streamId), source_category_id: group, reason: 'possible_duplicate_or_excluded' });
      continue;
    }
    additions.push({ stream_id: Number(streamId), category_id: target, name: title, epg_channel_id: '' });
    if (target !== eventId) names.add(identity(title));
    retired.delete(streamId);
  }

  for (const [group, floor] of Object.entries(mappings.minimumGroupCounts ?? {})) {
    if (!Number.isSafeInteger(floor) || floor < 1 || (groups.get(id(group)) ?? 0) < floor) {
      throw new Error('Provider group below approved inventory floor');
    }
  }
  if (slot !== undefined && (!Number.isSafeInteger(slot) || slot < (previous.slot ?? 0))) {
    throw new Error('Invalid inventory observation time');
  }
  for (const [streamId, row] of current) {
    if (protectedSet.has(streamId) || source.has(streamId)) continue;
    const category = id(row.category_id);
    missing.push({ stream_id: Number(streamId), category_id: category });
    // Use distinct accepted snapshots. A gap in hourly observations resets the count.
    if (slot === undefined || category !== eventId || row.epg_channel_id) continue;
    const prior = previous.missing?.[streamId];
    const count = slot === previous.slot ? (prior ?? 1) : slot - previous.slot === 1 ? (prior ?? 0) + 1 : 1;
    if (count >= 3) {
      removals.push(Number(streamId));
      retired.add(streamId);
    } else {
      nextMissing[streamId] = count;
    }
  }
  if ([additions, renames, removals].some(changes => changes.length > maxAdditions)) throw new Error('Change cap exceeded');
  return {
    mode, additions, renames, pending, missing, removals, replacements,
    state: { slot, missing: nextMissing, retired: [...retired] },
    counts: { current: current.size, provider: source.size }, publish: false,
  };
}

const paths = {
  categories: 'catalog/live_categories.json',
  live: 'catalog/live_all.json',
  m3u: 'catalog/template.m3u',
};
const groupPath = id => `catalog/by-category/${id}.json`;
const route = row => `{{BASE}}/live/{{USER}}/{{PASS}}/${row.stream_id}.ts`;
const attrs = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function playlistBlocks(text) {
  const starts = [...text.matchAll(/^#EXTINF:/gm)].map(match => match.index);
  const header = text.slice(0, starts[0]);
  if (!starts.length || !header.startsWith('#EXTM3U') || !header.includes('{{EPG_URL}}')) {
    throw new Error('Invalid existing playlist header');
  }
  const blocks = new Map();
  for (let i = 0; i < starts.length; i++) {
    const block = text.slice(starts[i], starts[i + 1]);
    const matches = [...block.matchAll(/^\{\{BASE\}\}\/live\/\{\{USER\}\}\/\{\{PASS\}\}\/(\d+)\.(?:ts|mpd|m3u8)\r?$/gm)];
    if (matches.length !== 1 || blocks.has(matches[0][1])) throw new Error('Invalid existing playlist block');
    blocks.set(matches[0][1], block);
  }
  return { header, blocks };
}

export function buildCatalogue({ assets, providerCategories, providerStreams, mappings, mode, protectedIds, excludedIds, previous, slot, baselineOnly = false }) {
  const categories = JSON.parse(assets[paths.categories]);
  const live = JSON.parse(assets[paths.live]);
  const { header, blocks } = playlistBlocks(assets[paths.m3u]);
  const rowIds = live.map(row => id(row.stream_id));
  if (!isDeepStrictEqual([...blocks.keys()], rowIds)) throw new Error('Existing M3U and Xtream order differ');
  const originalGroups = Map.groupBy(live, row => id(row.category_id));
  const categoryIds = categories.map(row => id(row.category_id));
  for (const category of categoryIds) {
    if (!isDeepStrictEqual(JSON.parse(assets[groupPath(category)]), originalGroups.get(category) ?? [])) {
      throw new Error('Existing Xtream category assets differ');
    }
  }

  if (baselineOnly) return { categories: categoryIds.length, streams: live.length };

  const plan = planCatalogue({ categories, live, providerCategories, providerStreams, mappings, mode, protectedIds, excludedIds,
    previous, slot, maxAdditions: mappings.maxChanges ?? 1000 });
  if (!plan.additions.length && !plan.renames.length && !plan.removals.length) return { plan, assets };
  const titles = new Map(plan.renames.map(row => [id(row.stream_id), row.name]));
  const remove = new Set(plan.removals);
  const output = { ...assets };
  const added = Map.groupBy(plan.additions, row => row.category_id);
  const rows = live.filter(row => !remove.has(row.stream_id)).map(row =>
    titles.has(id(row.stream_id)) ? { ...row, name: titles.get(id(row.stream_id)) } : row);
  const next = [];
  const names = new Map(categories.map(category => [id(category.category_id), category.category_name]));
  const nextGroups = Map.groupBy(rows, row => id(row.category_id));
  const alphabetic = new Intl.Collator('en-NZ', { numeric: true, sensitivity: 'base' });
  let num = live.reduce((max, row) => Math.max(max, row.num), 0);
  for (const category of categoryIds) {
    const items = nextGroups.get(category) ?? [];
    for (const addition of added.get(category) ?? []) {
      const row = { num: ++num, stream_type: 'live', stream_icon: '', added: '0', custom_sid: '', tv_archive: 0,
        direct_source: '', tv_archive_duration: 0, is_adult: 0, container_extension: 'ts', ...addition };
      const position = category === String(mappings.eventTarget) ? -1 :
        items.findIndex((item, index) => index >= 20 && alphabetic.compare(item.name, row.name) > 0);
      items.splice(position < 0 ? items.length : position, 0, row);
      const title = attrs(row.name);
      blocks.set(id(row.stream_id), `#EXTINF:-1 tvg-id="" tvg-name="${title}" tvg-logo="" group-title="${attrs(names.get(category))}",${row.name}\n${route(row)}\n`);
    }
    next.push(...items);
    if (!isDeepStrictEqual(items, originalGroups.get(category) ?? [])) output[groupPath(category)] = JSON.stringify(items);
  }
  for (const [streamId, title] of titles) {
    const block = blocks.get(streamId);
    const end = block.indexOf('\n');
    const info = block.slice(0, end);
    const separator = info.match(/^(?:[^",]|"[^"]*")*,/);
    if (!separator) throw new Error('Invalid event playlist metadata');
    const metadata = separator[0].replace(/\btvg-name="[^"]*"/, () => `tvg-name="${attrs(title)}"`);
    blocks.set(streamId, `${metadata}${title}${block.slice(end)}`);
  }
  output[paths.live] = JSON.stringify(next);
  output[paths.m3u] = header + next.map(row => blocks.get(id(row.stream_id))).join('');
  if (!isDeepStrictEqual([...playlistBlocks(output[paths.m3u]).blocks.keys()], next.map(row => id(row.stream_id)))) {
    throw new Error('Candidate M3U and Xtream order differ');
  }
  return { plan, assets: output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    process.stdout.write(JSON.stringify(input.assets ? buildCatalogue(input) : planCatalogue(input)) + '\n');
  } catch (error) {
    // The input and error stack can include private provider metadata.
    const message = error.constructor === Error ? error.message : 'Malformed input';
    console.error('Catalogue validation failed:', message);
    process.exitCode = 1;
  }
}
