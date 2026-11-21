/** Test HLS on Sky Sport NZ while preserving other BEST routes. */
export function bestRequestedStreamFormat(idPart, row, storedFormat="ts") {
  const isSkySportNz = row.category === "New Zealand"
    && /^SKY SPORT [1-9](?: HD BACKUP)?$/i.test(String(row.display_name || "").trim());
  if (isSkySportNz && /\.m3u8$/i.test(String(idPart || ""))) return "m3u8";
  return String(storedFormat || "ts").replace(/[^a-z0-9]/gi, "") || "ts";
}
