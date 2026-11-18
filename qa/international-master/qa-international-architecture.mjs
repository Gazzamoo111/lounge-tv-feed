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
  "Taiwan","Nepal","Afghanistan","Uzbekistan","Tajikistan","Kazakhstan","Asia (Other)",
  "France","Germany","Spain","Italy","Portugal","Netherlands","Poland",
  "Türkiye","Greece","Russia","Ukraine","Belgium","Czech Republic",
  "Romania","Austria","Albania","Switzerland","Croatia","Montenegro",
  "North Macedonia","Bulgaria","Bosnia","Cyprus","Hungary","Serbia",
  "Slovenia","Malta","Estonia","Belarus","Finland","Georgia","Kosovo",
  "Armenia","Azerbaijan","Balkans",
  "United Arab Emirates","Saudi Arabia","Israel","Iran","Arabic TV","Kurdish TV",
  "South Africa","Nigeria","Egypt","Kenya","Africa",
  "Mexico","Brazil","Argentina","Colombia","Chile","Suriname","Latin America","Caribbean",
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

// BEST prefixes are provider-specific, not ISO codes. In particular:
// AR means Arabic; IR mixes Iran/Ireland; CH mixes China/Switzerland.
const providerCountryPrefix = Object.freeze({
 NZ:"New Zealand",AU:"Australia",UK:"UK TV",GB:"UK TV",US:"US TV",
 CA:"Canada",IE:"Ireland",
 SG:"Singapore",MY:"Malaysia",ID:"Indonesia",
 JP:"Japan",KR:"South Korea",CN:"China",TH:"Thailand",VT:"Vietnam",
 VN:"Vietnam",PH:"Philippines",PK:"Pakistan",BD:"Bangladesh",
 BAN:"Bangladesh",TAI:"Taiwan",NP:"Nepal",AFG:"Afghanistan",UZ:"Uzbekistan",
 TJ:"Tajikistan",KA:"Kazakhstan",
 FR:"France",DE:"Germany",ES:"Spain",IT:"Italy",PT:"Portugal",
 NL:"Netherlands",PL:"Poland",TR:"Türkiye",GR:"Greece",RU:"Russia",
 UKR:"Ukraine",UA:"Ukraine",BE:"Belgium",CZ:"Czech Republic",RO:"Romania",
 AT:"Austria",AL:"Albania",HR:"Croatia",CG:"Montenegro",MK:"North Macedonia",
 BG:"Bulgaria",BH:"Bosnia",CY:"Cyprus",HU:"Hungary",RS:"Serbia",
 SL:"Slovenia",MT:"Malta",EST:"Estonia",BY:"Belarus",FI:"Finland",
 GE:"Georgia",KO:"Kosovo",AM:"Armenia",AZ:"Azerbaijan",
 AE:"United Arab Emirates",SA:"Saudi Arabia",IL:"Israel",IS:"Israel",
 ZA:"South Africa",NG:"Nigeria",EG:"Egypt",KE:"Kenya",
 BR:"Brazil",CO:"Colombia",MX:"Mexico",SU:"Suriname",
 AR:"Arabic TV",KU:"Kurdish TV",AFR:"Africa",EXYU:"Balkans",CRB:"Caribbean",
 SK:"South Korea"
});
export function masterRegionGroup(providerCategory) {
 const group=String(providerCategory||"").toUpperCase().trim();
 const match=/^([A-Z]{2,5})\s*\|/.exec(group);
 if(!match)return null;
 const prefix=match[1];
 // Some BEST category prefixes are shared by different countries.
 if(prefix==="IR"){
  if(/\bIRELAND\b/.test(group))return "Ireland";
  if(/\bIRAN\b/.test(group))return "Iran";
  return null;
 }
 if(prefix==="CH"){
  if(/\bSWITZERLAND\b/.test(group))return "Switzerland";
  if(/\bCHINA\b|\bHONG\s*KONG\b/.test(group))return "China";
  return null;
 }
 if(prefix==="LAT"){
  if(/\bMEXICO\b/.test(group))return "Mexico";
  if(/\bARGENTINA\b|\bARG\b/.test(group))return "Argentina";
  if(/\bCOLOMBIA\b/.test(group))return "Colombia";
  if(/\bCHILE\b/.test(group))return "Chile";
  return "Latin America";
 }
 if(prefix==="ASIA"){
  if(/\bINDIA\b|\bINDIAN\b/.test(group))return "India";
  return "Asia (Other)";
 }
 return providerCountryPrefix[prefix]||null;
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
  "Pakistan":"🇵🇰","Bangladesh":"🇧🇩","Taiwan":"🇹🇼",
  "Nepal":"🇳🇵","Afghanistan":"🇦🇫","Uzbekistan":"🇺🇿",
  "Tajikistan":"🇹🇯","Kazakhstan":"🇰🇿","Asia (Other)":"🌏",
  "France":"🇫🇷","Germany":"🇩🇪","Spain":"🇪🇸",
  "Italy":"🇮🇹","Portugal":"🇵🇹","Netherlands":"🇳🇱",
  "Poland":"🇵🇱","Türkiye":"🇹🇷","Greece":"🇬🇷",
  "Russia":"🇷🇺","Ukraine":"🇺🇦","Belgium":"🇧🇪","Czech Republic":"🇨🇿",
  "Romania":"🇷🇴","Austria":"🇦🇹","Albania":"🇦🇱","Switzerland":"🇨🇭",
  "Croatia":"🇭🇷","Montenegro":"🇲🇪","North Macedonia":"🇲🇰",
  "Bulgaria":"🇧🇬","Bosnia":"🇧🇦","Cyprus":"🇨🇾","Hungary":"🇭🇺",
  "Serbia":"🇷🇸","Slovenia":"🇸🇮","Malta":"🇲🇹","Estonia":"🇪🇪",
  "Belarus":"🇧🇾","Finland":"🇫🇮","Georgia":"🇬🇪","Kosovo":"🇽🇰",
  "Armenia":"🇦🇲","Azerbaijan":"🇦🇿","Balkans":"🌍",
  "United Arab Emirates":"🇦🇪","Saudi Arabia":"🇸🇦",
  "Israel":"🇮🇱","Iran":"🇮🇷","South Africa":"🇿🇦","Nigeria":"🇳🇬",
  "Egypt":"🇪🇬","Kenya":"🇰🇪","Africa":"🌍",
  "Arabic TV":"🌍","Kurdish TV":"🌍",
  "Mexico":"🇲🇽","Brazil":"🇧🇷","Argentina":"🇦🇷",
  "Colombia":"🇨🇴","Chile":"🇨🇱","Suriname":"🇸🇷","Latin America":"🌎",
  "Caribbean":"🌴","International TV":"🌍",
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
 masterVisibleOrder.map(g=>[g,`${icons[g]||"🌍"} ${labelOverrides[g]||g}`])
));
