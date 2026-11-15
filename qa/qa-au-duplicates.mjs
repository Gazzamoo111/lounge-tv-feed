// QA-only Australian channel presentation cleanup.
// Never removes provider inventory, changes playback bindings, or rewrites EPG.
// A matching shared EPG ID is necessary but not proof of identical streams.
// Only known secondary/simulcast families with an already-present preferred row qualify.
const SHARED_EPG = new Map([
  ["7FLIX","7flix.au"],
  ["7TWO","7two.au"],
  ["10 PEACH","10peach.au"],
  ["ABC ME","abcme.au"],
  ["SBS FOOD","sbsfood.au"],
  ["SBS VICELAND","sbsviceland.au"],
  ["SBS WORLD MOVIES","sbsworldmovies.au"],
  ["RACING.COM","racingcom.au"]
]);
const REGION_SUFFIX = /\s+(NATIONAL|SYDNEY|MELBOURNE|BRISBANE|PERTH|ADELAIDE|CANBERRA|HOBART|DARWIN)$/;

function identity(row) {
  const name=String(row.display_name||"").toUpperCase().trim()
    .replace(/^AU\s*[|:]\s*/,"").replace(/[ᴿᴬᵂ⁶⁰ᶠᵖˢᴴᴰ]/g,"").replace(/\s+/g," ");
  const suffix=REGION_SUFFIX.exec(name);
  const family=suffix?name.slice(0,suffix.index):name;
  if(!SHARED_EPG.has(family))return null;
  const epg=String(row.epg_id||"").trim().toLowerCase();
  if(epg!==SHARED_EPG.get(family))return null;
  return {family,region:suffix?.[1]||null};
}

export function qaAuVisibleRows(rows, groupOf) {
  const curated=new Set();
  const national=new Set();
  for(const row of rows) {
    if(groupOf(row)!=="Australia")continue;
    const ident=identity(row);
    if(!ident)continue;
    if(String(row.category||"").toUpperCase()!=="RAW" && !ident.region)curated.add(ident.family);
    if(String(row.category||"").toUpperCase()==="RAW" && ident.region==="NATIONAL")
      national.add(ident.family);
  }
  return rows.filter(row=>{
    if(groupOf(row)!=="Australia" || String(row.category||"").toUpperCase()!=="RAW")return true;
    const ident=identity(row);
    if(!ident || !ident.region)return true;
    // Do not hide distinct EPG schedules, local network variants, or unknown streams.
    if(curated.has(ident.family))return false;
    // No curated Racing.com channel: use the explicit national feed, retain
    // regional source IDs in BEST inventory for future QA/rollback.
    if(ident.family==="RACING.COM" && ident.region!=="NATIONAL"
       && national.has(ident.family))return false;
    return true;
  });
}
