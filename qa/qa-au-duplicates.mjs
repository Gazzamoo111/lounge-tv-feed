/**
 * QA-only Australian customer catalogue de-duplication.
 * Choose one visible row per channel identity, preferring curated, then national
 * or Sydney feeds. All BEST IDs and source bindings remain untouched internally.
 * This is presentation only, NOT proof of stream health or automated failover.
 */
const REGIONS=/\s+(?:NATIONAL|SYDNEY|MELBOURNE|BRISBANE|PERTH|ADELAIDE|CANBERRA|HOBART|DARWIN|NEWCASTLE|LISMORE|GOLD[\s-]?COAST|NSW|VIC|QLD|SA|WA)$/;
function normalise(value){
 let n=String(value||"").toUpperCase().trim()
  .replace(/^AU\s*[|:]\s*/,"")
  .replace(/\s*[ᴿᴬᵂ⁶⁰ᶠᵖˢᴴᴰ]+\s*/g," ")
  .replace(/\s+/g," ").trim();
 n=n.replace(/^9NOW\s+/,"").replace(/\s*\((?:NSW|VIC|QLD|SA|WA|GOLD-COAST|NEWCASTLE|LISMORE|NZ)\)$/,"");
 n=n.replace(/\s+(?:4K|UHD|FHD|1080P|HD|SD)$/,"").trim();
 n=n.replace(REGIONS,"").trim();
 if(/^CHANNEL 7TWO$/.test(n))return "7TWO";
 if(/^CHANNEL 9 GEM$/.test(n))return "9GEM";
 if(/^CHANNEL 7$/.test(n)||n==="SEVEN")return "SEVEN";
 if(/^CHANNEL 9$/.test(n))return "CHANNEL 9";
 if(/^CHANNEL 10$/.test(n)||n==="TEN")return "TEN";
 if(/^KAYO\s*-\s*/.test(n))n=n.replace(/^KAYO\s*-\s*/,"");
 if(/^FOX SPORTS 50[1-7](?:\s+(?:CRICKET|LEAUGE|LEAGUE|FOTTY|FOOTY))?$/.test(n))return n.match(/^FOX SPORTS 50[1-7]/)[0];
 if(/^FOX SPORTS NEWS(?: AUSTRALIA)?$/.test(n))return "FOX SPORTS NEWS";
 if(/^ESPN\s*1(?: AUSTRALIA)?$/.test(n)||n==="ESPN AUSTRALIA")return "ESPN 1";
 if(/^ESPN\s*2(?: AUSTRALIA)?$/.test(n)||n==="ESPN2 AUSTRALIA")return "ESPN 2";
 if(n==="REDBULL TV")return "RED BULL TV";
 if(n==="CHANNEL 7TWO")return "7TWO";
 if(/^SKY RACING [12]$/.test(n))return n;
 return n;
}
function rank(row){
 const name=String(row.display_name||"").toUpperCase();
 let score=String(row.category||"").toUpperCase()==="RAW"?0:1000;
 if(/\bNATIONAL\b/.test(name))score+=100;
 else if(/\bSYDNEY\b/.test(name)||/\(NSW\)/.test(name))score+=80;
 else if(/\bMELBOURNE\b/.test(name)||/\(VIC\)/.test(name))score+=60;
 if(/\b(?:FHD|HD)\b/.test(name))score+=5;
 return score;
}
export function qaAuVisibleRows(rows,groupOf){
 const winners=new Map();
 rows.forEach((row,index)=>{
  if(groupOf(row)!=="Australia")return;
  const key=normalise(row.display_name);
  if(!key)return;
  const previous=winners.get(key);
  if(!previous || rank(row)>previous.score)
   winners.set(key,{index,score:rank(row)});
 });
 return rows.filter((row,index)=>{
  if(groupOf(row)!=="Australia")return true;
  const key=normalise(row.display_name);
  return !key||winners.get(key)?.index===index;
 });
}
