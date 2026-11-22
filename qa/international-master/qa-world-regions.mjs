/** Universal Lounge TV International Master, QA only.
 * Presentation classification ONLY. Original stream ID, source, EPG and DRM
 * remain unchanged. Xtream/M3U is flat; country groups are NOT nested.
 */
export const worldRegionCatalog=Object.freeze([
  {
    "id": "New Zealand",
    "label": "🇳🇿 New Zealand",
    "legacy": [
      "New Zealand"
    ]
  },
  {
    "id": "Australia",
    "label": "🇦🇺 Australia",
    "legacy": [
      "Australia"
    ]
  },
  {
    "id": "UK & Ireland",
    "label": "🇬🇧 UK & Ireland",
    "legacy": [
      "UK TV",
      "Ireland"
    ]
  },
  {
    "id": "USA & Canada",
    "label": "🇺🇸 USA & Canada",
    "legacy": [
      "US TV",
      "Canada"
    ]
  },
  {
    "id": "Worldwide Sports",
    "label": "🏆 Worldwide Sports",
    "legacy": [
      "Sports Networks",
      "Asia Sports"
    ]
  },
  {
    "id": "World News",
    "label": "📰 World News",
    "legacy": [
      "News"
    ]
  },
  {
    "id": "South Asia",
    "label": "🌏 South Asia",
    "legacy": [
      "India",
      "India Regional",
      "India Streaming",
      "India Movies",
      "India News",
      "Pakistan",
      "Bangladesh",
      "Nepal",
      "Afghanistan"
    ]
  },
  {
    "id": "Southeast Asia",
    "label": "🌏 Southeast Asia",
    "legacy": [
      "Singapore",
      "Malaysia",
      "Indonesia",
      "Thailand",
      "Vietnam",
      "Philippines",
      "Asia (Other)"
    ]
  },
  {
    "id": "East Asia",
    "label": "🌏 East Asia",
    "legacy": [
      "Japan",
      "South Korea",
      "China",
      "Taiwan"
    ]
  },
  {
    "id": "Western Europe",
    "label": "🌍 Western Europe",
    "legacy": [
      "France",
      "Germany",
      "Netherlands",
      "Belgium",
      "Luxembourg",
      "Austria",
      "Switzerland"
    ]
  },
  {
    "id": "Northern Europe",
    "label": "🌍 Northern Europe",
    "legacy": [
      "Sweden",
      "Norway",
      "Denmark",
      "Finland",
      "Iceland",
      "Estonia"
    ]
  },
  {
    "id": "Southern Europe",
    "label": "🌍 Southern Europe",
    "legacy": [
      "Italy",
      "Spain",
      "Portugal",
      "Greece",
      "Türkiye",
      "Cyprus",
      "Malta"
    ]
  },
  {
    "id": "Eastern Europe & Balkans",
    "label": "🌍 Eastern Europe & Balkans",
    "legacy": [
      "Poland",
      "Czech Republic",
      "Romania",
      "Hungary",
      "Slovakia",
      "Slovenia",
      "Ukraine",
      "Russia",
      "Belarus",
      "Albania",
      "Croatia",
      "Montenegro",
      "North Macedonia",
      "Bulgaria",
      "Bosnia",
      "Serbia",
      "Kosovo",
      "Balkans",
      "Georgia",
      "Armenia",
      "Azerbaijan",
      "Uzbekistan",
      "Tajikistan",
      "Kazakhstan"
    ]
  },
  {
    "id": "Middle East & North Africa",
    "label": "🌍 Middle East & North Africa",
    "legacy": [
      "United Arab Emirates",
      "Saudi Arabia",
      "Israel",
      "Iran",
      "Arabic TV",
      "Kurdish TV",
      "Egypt"
    ]
  },
  {
    "id": "Sub-Saharan Africa",
    "label": "🌍 Sub-Saharan Africa",
    "legacy": [
      "South Africa",
      "Nigeria",
      "Kenya",
      "Africa"
    ]
  },
  {
    "id": "Latin America & Caribbean",
    "label": "🌎 Latin America & Caribbean",
    "legacy": [
      "Mexico",
      "Brazil",
      "Argentina",
      "Colombia",
      "Chile",
      "Suriname",
      "Latin America",
      "Caribbean"
    ]
  },
  {
    "id": "Entertainment & Movies",
    "label": "🎬 Entertainment & Movies",
    "legacy": [
      "Entertainment & Streaming",
      "Movie Channels"
    ]
  },
  {
    "id": "Kids & Family",
    "label": "🧸 Kids & Family",
    "legacy": [
      "Kids & Family"
    ]
  },
  {
    "id": "Documentaries, Lifestyle & Music",
    "label": "🎵 Documentaries, Lifestyle & Music",
    "legacy": [
      "Documentaries & Lifestyle",
      "Music"
    ]
  },
  {
    "id": "FAST TV",
    "label": "📡 FAST TV",
    "legacy": [
      "FAST TV"
    ]
  },
  {
    "id": "24/7 Channels",
    "label": "📺 24/7 Channels",
    "legacy": [
      "24/7 Movies & Series",
      "24/7 Movies",
      "24/7 Series",
      "24/7 Comedy",
      "24/7 Drama & Crime",
      "24/7 Reality",
      "24/7 Streaming",
      "24/7 Kids & Cartoons",
      "24/7 OnePlay"
    ]
  },
  {
    "id": "Other International",
    "label": "🌍 Other International",
    "legacy": [
      "International TV"
    ]
  },
  {
    "id": "Live Events & PPV",
    "label": "🏟️ Live Events & PPV",
    "legacy": [
      "Live Events",
      "PPV Source Overflow"
    ]
  }
]);
export const worldVisibleOrder=Object.freeze(worldRegionCatalog.map(g=>g.id));
export const worldCategoryLabels=Object.freeze(Object.fromEntries(worldRegionCatalog.map(g=>[g.id,g.label])));
const legacyBucket=new Map(worldRegionCatalog.flatMap(g=>g.legacy.map((name,order)=>[name,{bucket:g.id,order}])));
const countryCodes=Object.freeze({
  "New Zealand": "NZ",
  "Australia": "AU",
  "UK TV": "UK",
  "Ireland": "IE",
  "US TV": "US",
  "Canada": "CA",
  "India": "IN",
  "India Regional": "IN",
  "India Streaming": "IN",
  "India Movies": "IN",
  "India News": "IN",
  "Pakistan": "PK",
  "Bangladesh": "BD",
  "Nepal": "NP",
  "Afghanistan": "AF",
  "Singapore": "SG",
  "Malaysia": "MY",
  "Indonesia": "ID",
  "Thailand": "TH",
  "Vietnam": "VN",
  "Philippines": "PH",
  "Asia (Other)": "ASIA",
  "Japan": "JP",
  "South Korea": "KR",
  "China": "CN",
  "Taiwan": "TW",
  "France": "FR",
  "Germany": "DE",
  "Netherlands": "NL",
  "Belgium": "BE",
  "Luxembourg": "LU",
  "Austria": "AT",
  "Switzerland": "CH",
  "Sweden": "SE",
  "Norway": "NO",
  "Denmark": "DK",
  "Finland": "FI",
  "Iceland": "IS",
  "Estonia": "EE",
  "Italy": "IT",
  "Spain": "ES",
  "Portugal": "PT",
  "Greece": "GR",
  "Türkiye": "TR",
  "Cyprus": "CY",
  "Malta": "MT",
  "Poland": "PL",
  "Czech Republic": "CZ",
  "Romania": "RO",
  "Hungary": "HU",
  "Slovakia": "SK",
  "Slovenia": "SI",
  "Ukraine": "UA",
  "Russia": "RU",
  "Belarus": "BY",
  "Albania": "AL",
  "Croatia": "HR",
  "Montenegro": "ME",
  "North Macedonia": "MK",
  "Bulgaria": "BG",
  "Bosnia": "BA",
  "Serbia": "RS",
  "Kosovo": "XK",
  "Balkans": "BALKANS",
  "Georgia": "GE",
  "Armenia": "AM",
  "Azerbaijan": "AZ",
  "Uzbekistan": "UZ",
  "Tajikistan": "TJ",
  "Kazakhstan": "KZ",
  "United Arab Emirates": "AE",
  "Saudi Arabia": "SA",
  "Israel": "IL",
  "Iran": "IR",
  "Arabic TV": "ARABIC",
  "Kurdish TV": "KURDISH",
  "Egypt": "EG",
  "South Africa": "ZA",
  "Nigeria": "NG",
  "Kenya": "KE",
  "Africa": "AFRICA",
  "Mexico": "MX",
  "Brazil": "BR",
  "Argentina": "AR",
  "Colombia": "CO",
  "Chile": "CL",
  "Suriname": "SR",
  "Latin America": "LATAM",
  "Caribbean": "CARIB"
});
const geographic=new Set([
  "UK & Ireland","USA & Canada","South Asia","Southeast Asia","East Asia",
  "Western Europe","Northern Europe","Southern Europe","Eastern Europe & Balkans",
  "Middle East & North Africa","Sub-Saharan Africa","Latin America & Caribbean"
]);
export function worldRegionFor(legacyGroup){
  return legacyBucket.get(String(legacyGroup||""))?.bucket||"Other International";
}
export function worldCountryOrder(legacyGroup){
  return legacyBucket.get(String(legacyGroup||""))?.order??999;
}
export function worldDisplayName(row,legacyGroup){
  const bucket=worldRegionFor(legacyGroup);
  const name=String(row?.display_name||"").trim();
  if(!geographic.has(bucket))return name;
  const code=countryCodes[String(legacyGroup||"")];
  if(!code)return name;
  const simple=name.replace(/^[A-Z]{2,5}\s*\|\s*/i,"").trim();
  return code+" | "+simple;
}
export function worldCountryLabel(legacyGroup){return countryCodes[String(legacyGroup||"")]||"";}
