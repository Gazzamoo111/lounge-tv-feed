const actions = new Map([
  ['get_vod_categories', ['movie', 'categories']],
  ['get_vod_streams', ['movie', 'list']],
  ['get_vod_info', ['movie', 'detail', 'vod_id']],
  ['get_series_categories', ['series', 'categories']],
  ['get_series', ['series', 'list']],
  ['get_series_info', ['series', 'detail', 'series_id']],
]);

export const isVodAction = action => actions.has(action);
const idPattern = /^[1-9]\d{0,11}$/;
const formatPattern = /^[a-z0-9]{1,8}$/;
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
};

async function vodPrefix(env) {
  if (env.ENABLE_VOD !== 'true') return null;
  const pointer = await env.ASSETS.get('vod/current.json');
  if (!pointer) return null;
  const { release } = await pointer.json();
  if (!/^v[a-zA-Z0-9_-]{1,48}$/.test(release)) throw Error('invalid VOD release');
  return `vod/releases/${release}`;
}

export async function vodAction(url, env, action, json, problem) {
  const [kind, operation, parameter] = actions.get(action);
  const prefix = await vodPrefix(env);
  if (!prefix) return json(operation === 'detail' ? {} : []);
  const value = url.searchParams.get(parameter ?? 'category_id');
  if (operation === 'detail' && !idPattern.test(value ?? '')) return problem('not_found', 404);
  if (operation === 'list' && value && value !== '0' && !idPattern.test(value)) return json([]);
  const filter = operation === 'list' && value && value !== '0' ? value : null;
  const key = operation === 'detail' ? `detail/${value}.json` :
    operation === 'categories' ? 'categories.json' : `list/${filter ?? 'all'}.json`;
  const object = await env.ASSETS.get(`${prefix}/${kind}/${key}`);
  if (object) return new Response(object.body, { headers });
  if (operation === 'detail') return problem('not_found', 404);
  return filter ? json([]) : problem('vod_catalogue_not_ready', 503);
}

export function playbackShard(id) {
  return String(Number(id) % 256).padStart(3, '0');
}

export async function vodPlayback(kind, id, account, env, providerCredentials, problem) {
  const prefix = await vodPrefix(env);
  if (!prefix) return problem('not_found', 404);
  const shard = await env.ASSETS.get(`${prefix}/${kind}/play/${playbackShard(id)}.json`);
  const mappings = shard ? await shard.json() : {};
  const source = mappings[id];
  if (!source || !idPattern.test(String(source.id)) || !formatPattern.test(source.ext)) {
    return problem('unknown_stream', 404);
  }
  const upstream = new URL(env.UPSTREAM_ORIGIN);
  const approvedHttp = upstream.protocol === 'http:' && env.ALLOW_HTTP_UPSTREAM === 'true';
  if ((!approvedHttp && upstream.protocol !== 'https:') || upstream.username || upstream.password) {
    return problem('provider_not_configured', 503);
  }
  const provider = await providerCredentials(account.row, env);
  upstream.pathname = `/${kind}/${encodeURIComponent(provider.username)}/${encodeURIComponent(provider.password)}/${source.id}.${source.ext}`;
  upstream.search = '';
  upstream.hash = '';
  return new Response(null, {
    status: 302,
    headers: { Location: upstream.href, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

export async function vodPlaylistSuffix(url, account, env) {
  if (env.ENABLE_VOD_M3U !== 'true') return null;
  const type = url.searchParams.get('type');
  if (type && type !== 'm3u_plus' && type !== 'm3u') return null;
  const prefix = await vodPrefix(env);
  if (!prefix) return null;
  const asset = await env.ASSETS.get(`${prefix}/playlist.m3u`);
  if (!asset) return null;
  const prefixUrl = url.origin;
  const user = encodeURIComponent(account.username);
  const pass = encodeURIComponent(account.password);
  let tail = '';
  const replace = text => text.replace(/^(\/movie|\/series)\//gm, `${prefixUrl}$1/${user}/${pass}/`);
  return asset.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream({
    transform(chunk, controller) {
      const text = tail + chunk;
      const end = text.lastIndexOf('\n') + 1;
      if (end) controller.enqueue(replace(text.slice(0, end)));
      tail = text.slice(end);
    },
    flush(controller) {
      if (tail) controller.enqueue(replace(tail));
    },
  })).pipeThrough(new TextEncoderStream());
}

export function withVodSuffix(live, suffix) {
  const encoder = new TextEncoder();
  const reader = suffix.getReader();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(live.endsWith('\n') ? live : live + '\n'));
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
