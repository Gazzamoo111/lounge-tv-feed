/**
 * Lounge TV Plus: QA-only, 20-category customer-facing M3U presentation.
 * Uses NZ/AU v36 curated source identities, DRM, EPG and provider URLs unchanged.
 * No category named Asia Sports or News, but rows are never deleted by this mapper.
 */
export const PLUS_ORDER=Object.freeze([
  "New Zealand","Australia","UK TV","UK Sports","US TV","US Sports",
  "Sports Networks","Streaming Services","Movie Channels","Kids & Family",
  "Documentaries & Lifestyle","FAST TV","Music",
  "24/7 Movies","24/7 Series","24/7 Comedy & Reality",
  "24/7 Drama & Crime","24/7 Streaming & OnePlay",
  "24/7 Kids & Cartoons","Live Events"
]);
export const PLUS_LABELS=Object.freeze({
  "New Zealand":"01 🇳🇿 New Zealand",
  "Australia":"02 🇦🇺 Australia",
  "UK TV":"03 🇬🇧 UK TV & Entertainment",
  "UK Sports":"04 🇬🇧 ⚽ UK Sports",
  "US TV":"05 🇺🇸 US TV & Entertainment",
  "US Sports":"06 🇺🇸 🏀 US Sports",
  "Sports Networks":"07 🏆 Sports Networks",
  "Streaming Services":"08 ▶️ Streaming Services",
  "Movie Channels":"09 🎬 Movie Channels",
  "Kids & Family":"10 🧸 Kids and Family",
  "Documentaries & Lifestyle":"11 🌿 Documentaries and Lifestyle",
  "FAST TV":"12 📡 FAST TV",
  "Music":"13 🎵 Music",
  "24/7 Movies":"14 🍿 24/7 Movies",
  "24/7 Series":"15 📺 24/7 Series",
  "24/7 Comedy & Reality":"16 🎭 24/7 Comedy & Reality",
  "24/7 Drama & Crime":"17 🎬 24/7 Drama and Crime",
  "24/7 Streaming & OnePlay":"18 ▶️ 24/7 Streaming & OnePlay",
  "24/7 Kids & Cartoons":"19 🎨 24/7 Kids and Cartoons",
  "Live Events":"20 🏟️ Live Events"
});
export const PLUS_IDS=Object.freeze(Object.fromEntries(PLUS_ORDER.map((g,i)=>[g,String(2800101+i)])));
const has=(text,re)=>re.test(String(text||"").toUpperCase());

export function plusCategory(row, original){
  const g=String(original||"");
  const source=String(row.subcategory||"").toUpperCase();
  const category=String(row.category||"").toUpperCase();
  const name=String(row.display_name||"").toUpperCase();
  const uk=/^UK\s*\|/.test(source)||/^UK(?:\s|$)/.test(source)||g==="UK TV";
  const us=/^US\s*\|/.test(source)||/^US(?:\s|$)/.test(source)||g==="US TV";
  if(g.startsWith("24/7")){
    if(g==="24/7 Kids & Cartoons")return "24/7 Kids & Cartoons";
    if(g==="24/7 OnePlay"||g==="24/7 Streaming")return "24/7 Streaming & OnePlay";
    if(g==="24/7 Comedy"||g==="24/7 Reality")return "24/7 Comedy & Reality";
    if(g==="24/7 Drama & Crime")return "24/7 Drama & Crime";
    if(g==="24/7 Movies")return "24/7 Movies";
    if(g==="24/7 Series")return "24/7 Series";
    // Former "Movies & Series" is the mixed fallback bucket. File/actor-labelled
    // stations go to Movies, otherwise preserve them in Series.
    return /MOVIE|FILM|CINEMA|HOLLYWOOD|ACTOR|ACTION & ADVENTURE/.test(source+" "+name)
      ? "24/7 Movies":"24/7 Series";
  }
  // Live fixtures/PPV remain in Live Events, regardless of country.
  if(g==="Live Events")return "Live Events";
  if(g==="New Zealand")return "New Zealand";
  if(g==="Australia")return "Australia";
  if(g==="FAST TV")return "FAST TV";
  if(g==="Movie Channels")return "Movie Channels";
  if(g==="Kids & Family")return "Kids & Family";
  if(g==="Documentaries & Lifestyle")return "Documentaries & Lifestyle";
  if(g==="Music")return "Music";
  if(g==="Sports Networks")return uk?"UK Sports":us?"US Sports":"Sports Networks";
  if(g==="UK TV")return "UK TV";
  if(g==="US TV")return "US TV";
  if(g==="News")return uk?"UK TV":us?"US TV":"Documentaries & Lifestyle";
  if(g==="Entertainment & Streaming"){
    // Retain provider streaming/FAST in common sections. Linear UK/US
    // entertainment is shown under its country.
    if(/STREAMING|NETFLIX|PRIME VIDEO|HULU|PARAMOUNT|PEACOCK|DISNEY|APPLE TV|HBO|SKYMIX|BBCIPLAYER|ITV X/.test(source))
      return "Streaming Services";
    return uk?"UK TV":us?"US TV":"Streaming Services";
  }
  if(g==="International TV"){
    if(uk)return /SPORT|FOOTBALL|RUGBY|CRICKET/.test(source)?"UK Sports":"UK TV";
    if(us)return /SPORT|NBA|NFL|MLB|NHL/.test(source)?"US Sports":"US TV";
    if(/SPORT|RUGBY|CRICKET|F1|MOTOGP|NBA|NFL/.test(source+" "+name))return "Sports Networks";
    if(/MOVIE|FILM|CINEMA/.test(source+" "+name))return "Movie Channels";
    if(/KIDS|CARTOON|PRESCHOOL/.test(source+" "+name))return "Kids & Family";
    if(/DOCUMENT|LIFESTYLE|NEWS/.test(source+" "+name))return "Documentaries & Lifestyle";
    return "Streaming Services";
  }
  if(category==="SPORTS")return uk?"UK Sports":us?"US Sports":"Sports Networks";
  // Always classify instead of dropping an unrecognised channel.
  return uk?"UK TV":us?"US TV":"Streaming Services";
}

export function plusRows(rows, groupOf){
  const arranged=rows.map((row,i)=>({row,i,group:plusCategory(row,groupOf(row))}));
  const idx=Object.fromEntries(PLUS_ORDER.map((name,i)=>[name,i]));
  if(arranged.some(x=>idx[x.group]===undefined))
    throw new Error("Plus category not present in category contract");
  arranged.sort((a,b)=>idx[a.group]-idx[b.group]||a.i-b.i);
  return arranged;
}
