import {nzSourceForBinding,nzPlaylistLines} from "./nz-routing.mjs";

/**
 * Emits opt-in DRM fields for a compatible Xtream importer.
 * The existing Xtream fields and all non-TVNZ channels remain unchanged.
 * This does not reveal encryption keys or bypass Widevine.
 */
export function qaTvnzXtreamDrmFields(row) {
  if (!row || row.provider_name!=="MJH NZ") return {};
  const id=Number(row.provider_stream_id);
  if(id!==900000001 && id!==900000002) return {};
  const nz=nzSourceForBinding(row.provider_name,id);
  if(!nz || nz.drm!=="widevine" || nz.format!=="mpd" ||
     !nz.url?.startsWith("https://i.mjh.nz/.r/") ||
     !nz.license?.startsWith("https://c.mjh.nz/")) return {};
  const lines=nzPlaylistLines(nz);
  const prefix="#EXTVLCOPT:http-user-agent=";
  const ua=lines.find(line=>line.startsWith(prefix))?.slice(prefix.length)||"";
  return {
    lounge_drm_scheme:"widevine",
    lounge_drm_manifest:"mpd",
    lounge_drm_license:nz.license,
    lounge_stream_url:nz.url,
    lounge_stream_user_agent:ua,
  };
}
