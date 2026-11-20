import directEpg from "./direct-epg.json" with { type: "json" };

const M3U_FIELDS = /^(#EXTINF:(?:[^",]|"[^"]*")*)(,.*)$/;
const CHANNEL_ID = /(?:^|\s)channel-id="([^"]*)"/;
const EPG_ID = /(\stvg-id=")([^"]*)"/;
const GROUP_TITLE = /(\sgroup-title=")([^"]*)"/;
const decode = (value) => value.replace(/&(amp|quot|lt|gt|#39);/g, (_, key) =>
  ({amp:"&",quot:'"',lt:"<",gt:">","#39":"'"}[key]));
const escapeAttribute = (value) => value.replace(/[&"<>]/g, (ch) =>
  ({"&":"&amp;",'"':"&quot;","<":"&lt;",">":"&gt;"}[ch]));

export function rewriteDisplayMetadata(line, epgMap) {
  const match = M3U_FIELDS.exec(line);
  if (!match) return line;
  const [, fields, displayName] = match;
  const channel = CHANNEL_ID.exec(fields);
  const candidate = channel && epgMap?.[decode(channel[1])];
  const categoryFixed = fields.replace(GROUP_TITLE, (_, prefix, group) =>
    prefix + group.replace(/&amp;/g, "&") + '"');
  const mapped = Array.isArray(candidate) ? categoryFixed.replace(EPG_ID, (original, prefix, id) =>
    decode(id) === candidate[0] ? prefix + escapeAttribute(candidate[1]) + '"' : original
  ) : categoryFixed;
  return mapped + displayName;
}

export function addDirectEpg(playlist) {
  const header = /^#EXTM3U x-tvg-url="(https:\/\/[^"\r\n]+\/xmltv\.php\?[^"\r\n]+)"(?=\r?\n)/;
  if (!header.test(playlist)) return playlist;
  return playlist.replace(header, (_, canonical) =>
    '#EXTM3U x-tvg-url="' + [canonical, ...directEpg.guides].join(",") + '"'
  ).replace(/^#EXTINF:[^\r\n]*/gm, line => rewriteDisplayMetadata(line, directEpg.map));
}

export async function addDirectEpgToPlus(response) {
  if (!response.ok || !response.headers.get("Content-Type")?.includes("mpegURL")) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(addDirectEpg(await response.text()), {
    status: response.status, statusText: response.statusText, headers
  });
}
