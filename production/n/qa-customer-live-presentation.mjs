/**
 * Customer-facing QA-only presentation rules.
 * No provider URL, ID, source role, EPG, DRM, channel number or stream format changes.
 * Existing tested NZ TVNZ / Sky Sport media routes must remain identical.
 */
export const qaCustomerCategoryLabels = Object.freeze({
 "New Zealand":"01 🇳🇿 New Zealand",
 "Australia":"02 🇦🇺 Australia",
 "Sports Networks":"03 🏆 Sports Networks",
 "UK TV":"04 🇬🇧 UK TV",
 "US TV":"05 🇺🇸 US TV",
 "Entertainment & Streaming":"06 ▶️ Streaming Services",
 "FAST TV":"07 📡 FAST TV",
 "Movie Channels":"08 🎬 Movie Channels",
 "Movie Streams":"09 🎞️ Movie Streams",
 "Kids & Family":"10 🧸 Kids and Family",
 "Documentaries & Lifestyle":"11 🌿 Documentaries and Lifestyle",
 "News":"12 📰 News",
 "24/7 Movies & Series":"13 🍿 24/7 Movies and Series",
 "24/7 Movies":"14 🎞️ 24/7 Movies",
 "24/7 Series":"15 📺 24/7 Series",
 "24/7 Comedy":"16 🎭 24/7 Comedy",
 "24/7 Drama & Crime":"17 🎬 24/7 Drama and Crime",
 "24/7 Reality":"18 📹 24/7 Reality",
 "24/7 Streaming":"19 ▶️ 24/7 Streaming",
 "24/7 Kids & Cartoons":"20 🎨 24/7 Kids and Cartoons",
 "24/7 OnePlay":"21 ▶️ 24/7 OnePlay",
 "Music":"22 🎵 Music",
 "International TV":"23 🌍 International TV",
 "Live Events":"99 🗄️ Sports Event Sources"
});

const excludedNzNames = [
  /^TVNZ DUKE$/,
  /^SKY SPORT 10 SELECT$/,
  /^EDEN$/,
  /^FIRST\s*LIGHT$/,
  /^MAORI TELEVISION$/,
  /^PRIME$/,
  /^RUSH$/,
  /^SHINE TV$/,
  /^(?:TAB\s+)?TRACK\s*SIDE\s+[12]$/,
  /^TVSN SHOPPING$/,
  /^WAIRARAPA TV$/,
  /^PARLIAMENT\s*TV$/,
  /^CH\s*200$/
];

function cleanName(value) {
  return String(value || "")
    .replace(/^(?:NZ|AU|UK|US)\s*\|\s*/i,"")
    .replace(/\s+/g," ")
    .trim()
    .replace(/\s+(?:SD|HD|FHD|UHD|4K|1080P|720P)$/i,"")
    .trim().toUpperCase();
}

/** Inventory rows are filtered by *exact channel name*, not substring. */
export function qaCustomerLiveRows(rows, groupOf) {
  return rows.flatMap(row => {
    const normalized=cleanName(row.display_name);
    const nz = groupOf(row)==="New Zealand";
    // JUICE TV duplicates can occur outside the New Zealand group.
    if(normalized==="JUICE TV")return [];
    if(nz && excludedNzNames.some(rule=>rule.test(normalized)))return [];
    // Keep the HD Backup label distinct from the main channel during source QA.
    return [row];
  });
}
