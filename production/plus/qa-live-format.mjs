/** Preserve current BEST TS playback unless the client explicitly requests HLS. */
export function bestRequestedStreamFormat(idPart, storedFormat="ts") {
  if (/\.m3u8$/i.test(String(idPart || "").trim())) return "m3u8";
  return String(storedFormat || "ts").replace(/[^a-z0-9]/gi, "").toLowerCase() || "ts";
}
