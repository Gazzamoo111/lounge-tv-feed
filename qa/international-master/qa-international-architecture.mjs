/**
 * International Master QA category contract.
 * Flat Xtream IDs, deterministic browse order, nonempty categories only.
 * Geographic classification requires an explicit provider country prefix,
 * never a guessed country from a channel name or language.
 * This module does not edit stream IDs, DRM routes, logos or EPG identifiers.
 */
export const masterVisibleOrder = Object.freeze([
  "New Zealand","Australia","UK TV","US TV","Sports Networks","Asia Sports",
  "Entertainment & Streaming","FAST TV","Movie Channels","Kids & Family",
  "Documentaries & Lifestyle","News",
  "24/7 Movies & Series","24/7 Movies","24/7 Series","24/7 Comedy",
  "24/7 Drama & Crime","24/7 Reality","24/7 Streaming",
  "24/7 Kids & Cartoons","24/7 OnePlay","Music",
  "Canada","Ireland",
  "India","India Regional","India Streaming","India Movies","India News",
  "Singapore","Malaysia","Indonesia","Japan","South Korea","China",
  "Thailand","Vietnam","Philippines","Pakistan","Bangladesh",
  "France","Germany","Spain","Italy","Portugal","Netherlands","Poland",
  "Türkiye","Greece","Russia","Ukraine",
  "United Arab Emirates","Saudi Arabia","Israel",
  "South Africa","Nigeria","Egypt","Kenya",
  "Mexico","Brazil","Argentina","Colombia",
  "International TV","Live Events","PPV Source Overflow"
]);

export const masterSeaGroups = new Set([
  "India","India Regional","India Streaming","India News","India Movies",
  "Indonesia","Malaysia","Singapore","Asia Sports","Singapore Sports",
  "Malaysia Sports","Sports Networks","Live Sports Events",
  "Football","F1 & MotoGP","Basketball","MMA & Boxing"
]);

const seaGroupMap = Object.freeze({
  "India":"India",
  "India Regional":"India Regional",
  "India Streaming":"India Streaming",
  "India News":"India News",
  "India Movies":"India Movies",
  "Indonesia":"Indonesia",
  "Malaysia":"Malaysia",
  "Singapore":"Singapore",
  "Asia Sports":"Asia Sports",
  "Singapore Sports":"Asia Sports",
  "Malaysia Sports":"Asia Sports",
  "Sports Networks":"Sports Networks",
  "Live Sports Events":"Live Events",
  "Football":"Live Events",
  "F1 & MotoGP":"Live Events",
  "Basketball":"Live Events",
  "MMA & Boxing":"Live Events"
});
export function masterSeaGroup(group) {
  return seaGroupMap[String(group||"").trim()]||null;
}

const providerCountryPrefix = Object.freeze({
  NZ:"New Zealand",AU:"Australia",UK:"UK TV",GB:"UK TV",
  US:"US TV",CA:"Canada",IE:"Ireland",IR:"Ireland",
  IN:"India",SG:"Singapore",MY:"Malaysia",ID:"Indonesia",
  JP:"Japan",KR:"South Korea",CN:"China",TH:"Thailand",
  VN:"Vietnam",PH:"Philippines",PK:"Pakistan",BD:"Bangladesh",
  FR:"France",DE:"Germany",ES:"Spain",IT:"Italy",PT:"Portugal",
  NL:"Netherlands",PL:"Poland",TR:"Türkiye",GR:"Greece",
  RU:"Russia",UA:"Ukraine",AE:"United Arab Emirates",
  SA:"Saudi Arabia",IL:"Israel",ZA:"South Africa",
  NG:"Nigeria",EG:"Egypt",KE:"Kenya",MX:"Mexico",
  BR:"Brazil",AR:"Argentina",CO:"Colombia"
});
export function masterRegionGroup(providerCategory) {
  const group=String(providerCategory||"").toUpperCase();
  const match=/^\s*([A-Z]{2})\s*\|/.exec(group);
  return match ? providerCountryPrefix[match[1]]||null : null;
}

const icons = Object.freeze({
  "New Zealand":"🇳🇿","Australia":"🇦🇺","UK TV":"🇬🇧","US TV":"🇺🇸",
  "Sports Networks":"🏆","Asia Sports":"🏆",
  "Entertainment & Streaming":"▶️","FAST TV":"📡",
  "Movie Channels":"🎬","Kids & Family":"🧸",
  "Documentaries & Lifestyle":"🌿","News":"📰",
  "24/7 Movies & Series":"🍿","24/7 Movies":"🎞️",
  "24/7 Series":"📺","24/7 Comedy":"🎭",
  "24/7 Drama & Crime":"🎬","24/7 Reality":"📹",
  "24/7 Streaming":"▶️","24/7 Kids & Cartoons":"🎨",
  "24/7 OnePlay":"▶️","Music":"🎵",
  "Canada":"🇨🇦","Ireland":"🇮🇪","India":"🇮🇳",
  "India Regional":"🇮🇳","India Streaming":"🇮🇳",
  "India Movies":"🇮🇳","India News":"🇮🇳",
  "Singapore":"🇸🇬","Malaysia":"🇲🇾","Indonesia":"🇮🇩",
  "Japan":"🇯🇵","South Korea":"🇰🇷","China":"🇨🇳",
  "Thailand":"🇹🇭","Vietnam":"🇻🇳","Philippines":"🇵🇭",
  "Pakistan":"🇵🇰","Bangladesh":"🇧🇩",
  "France":"🇫🇷","Germany":"🇩🇪","Spain":"🇪🇸",
  "Italy":"🇮🇹","Portugal":"🇵🇹","Netherlands":"🇳🇱",
  "Poland":"🇵🇱","Türkiye":"🇹🇷","Greece":"🇬🇷",
  "Russia":"🇷🇺","Ukraine":"🇺🇦",
  "United Arab Emirates":"🇦🇪","Saudi Arabia":"🇸🇦",
  "Israel":"🇮🇱","South Africa":"🇿🇦","Nigeria":"🇳🇬",
  "Egypt":"🇪🇬","Kenya":"🇰🇪",
  "Mexico":"🇲🇽","Brazil":"🇧🇷","Argentina":"🇦🇷",
  "Colombia":"🇨🇴","International TV":"🌍",
  "Live Events":"🏟️","PPV Source Overflow":"🗄️"
});
const labelOverrides = Object.freeze({
  "Entertainment & Streaming":"Streaming Services",
  "Kids & Family":"Kids and Family",
  "Documentaries & Lifestyle":"Documentaries and Lifestyle",
  "24/7 Movies & Series":"24/7 Movies and Series",
  "24/7 Drama & Crime":"24/7 Drama and Crime",
  "24/7 Kids & Cartoons":"24/7 Kids and Cartoons",
  "PPV Source Overflow":"PPV Source Overflow"
});
export const masterCategoryLabels = Object.freeze(Object.fromEntries(
  masterVisibleOrder.map((g,i)=>[
    g,
    `${g==="Live Events"?"98":g==="PPV Source Overflow"?"99":String(i+1).padStart(2,"0")} ${icons[g]||"🌍"} ${labelOverrides[g]||g}`
  ])
));
