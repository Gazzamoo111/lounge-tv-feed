/** Approved public Freeview sources already shipped in Lounge TV; no account secrets. */
const NZ_SOURCES = new Map([
  [900000001, { slug: 'tvnz-1', format: 'mpd', drm: 'widevine' }],
  [900000002, { slug: 'tvnz-2', format: 'mpd', drm: 'widevine' }],
  [900000003, { slug: 'three', format: 'm3u8', drm: null }],
  [900000004, { slug: 'maori-tv', format: 'm3u8', drm: null }],
  [900000005, { slug: 'te-reo', format: 'm3u8', drm: null }],
]);
export function nzSourceForBinding(provider, id) {
  if (provider !== 'MJH NZ') return null;
  const source = NZ_SOURCES.get(Number(id));
  return source ? { ...source, url: `https://i.mjh.nz/.r/${source.slug}.${source.format}`,
    license: source.drm ? `https://c.mjh.nz/${source.slug}-wv` : null } : null;
}
export function nzPlaylistLines(source) {
  if (!source) return [];
  const lines = ['#EXTVLCOPT:http-user-agent=otg/1.5.1 (AppleTv Apple TV 4; tvOS16.0; appletv.client) libcurl/7.58.0 OpenSSL/1.0.2o zlib/1.2.11 clib/1.8.56'];
  if (source.drm) lines.push('#KODIPROP:inputstream.adaptive.manifest_type=mpd',
    '#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha',
    `#KODIPROP:inputstream.adaptive.license_key=${source.license}`);
  return [...lines, source.url];
}

