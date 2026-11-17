/**
 * Customer-facing QA-only presentation rules.
 * No provider URL, ID, source role, EPG, DRM, channel number or stream format changes.
 * Existing tested NZ TVNZ / Sky Sport media routes must remain identical.
 */
export const qaCustomerCategoryLabels = Object.freeze({
  "New Zealand": "01 New Zealand",
  "Australia": "02 Australia",
  "Sports Networks": "03 Sports Networks",
  "UK TV": "04 UK TV",
  "US TV": "05 US TV",
  "Entertainment & Streaming": "06 Streaming Channels",
  "FAST TV": "07 Free Streaming TV",
  "Movie Channels": "08 Movie Channels",
  "Kids & Family": "09 Kids & Family",
  "Documentaries & Lifestyle": "10 Documentaries & Lifestyle",
  "News": "11 News",
  "24/7 Movies & Series": "12 24/7 Movies & Series",
  "24/7 Movies": "13 24/7 Movies",
  "24/7 Series": "14 24/7 Series",
  "24/7 Comedy": "15 24/7 Comedy",
  "24/7 Drama & Crime": "16 24/7 Drama & Crime",
  "24/7 Reality": "17 24/7 Reality TV",
  "24/7 Streaming": "18 24/7 Streaming",
  "24/7 Kids & Cartoons": "19 24/7 Kids & Cartoons",
  "24/7 OnePlay": "20 24/7 OnePlay",
  "Music": "21 Music",
  "International TV": "22 International TV",
  "Live Events": "99 Live Sports Events"
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
  /^WAIRARAPA TV$/
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
    const sky=/^SKY SPORT ([1-9]) HD BACKUP$/i.exec(String(row.display_name||"").trim());
    if(nz && sky){
      return [{...row, display_name:"Sky Sport "+sky[1]}];
    }
    return [row];
  });
}
