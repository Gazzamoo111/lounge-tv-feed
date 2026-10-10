/* Lounge TV v1 metadata validator. Never publish stream URLs or credentials. */
const secretKey=/(password|username|secret|credential|api[_-]?key|playlist[_-]?url|stream[_-]?url|token|upstream)/i;
const risky=/(player_api\.php|\/live\/|\/movie\/|\/series\/|username=|password=|token=|access=|loungebestvod:\/\/|localhost|127\.0\.0\.1|192\.168\.)/i;
function check(v,path="$",depth=0){
  if(depth>12)throw Error("Nested content exceeds safe limit");
  if(Array.isArray(v)){for(const [i,item] of v.entries())check(item,path+"["+i+"]",depth+1);return;}
  if(v&&typeof v==="object"){for(const [k,val] of Object.entries(v)){
    if(secretKey.test(k))throw Error("Secret field forbidden at "+path+"."+k);
    check(val,path+"."+k,depth+1);
  }return;}
  if(typeof v==="string"&&risky.test(v))throw Error("Provider or local URL forbidden at "+path);
}
function rows(items,name){
  if(!Array.isArray(items)||items.length>25000)throw Error(name+" invalid");
  const ids=new Set();
  for(const x of items){
    if(!x||typeof x!=="object"||typeof x.id!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x.id))throw Error(name+" bad ID");
    if(ids.has(x.id))throw Error(name+" duplicate ID");ids.add(x.id);
    if(typeof x.name!=="string"||!x.name.trim()||x.name.length>160)throw Error(name+" missing name");
    if(x.artwork&&(!/^https:\/\//.test(x.artwork)||x.artwork.length>1200))throw Error(name+" invalid artwork URL");
  }
  return ids;
}
export function validateRelease(r){
  if(!r||r.schema!==1||!/^[A-Za-z0-9._-]{8,64}$/.test(String(r.revision||""))||!Number.isFinite(Date.parse(r.generated_at)))throw Error("Invalid release metadata");
  check(r);
  const live=rows(r.live?.channels,"live");
  const vod=rows(r.vod?.titles,"vod");
  for(const t of r.vod.titles)if(!["movie","series"].includes(t.type))throw Error("Invalid VOD type");
  if(!Array.isArray(r.epg?.programmes)||r.epg.programmes.length>100000)throw Error("Invalid EPG");
  for(const p of r.epg.programmes){
    if(!live.has(p.channel_id)||!Number.isFinite(Date.parse(p.start))||!Number.isFinite(Date.parse(p.end))||Date.parse(p.start)>=Date.parse(p.end)||!String(p.title||"").trim())throw Error("Invalid EPG programme");
  }
  return {revision:r.revision,live_channels:live.size,vod_titles:vod.size,epg_programmes:r.epg.programmes.length};
}