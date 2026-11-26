import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function planCatalogue({categories, live, providerCategories, providerStreams, mappings, mode="events", protectedIds=[], maxAdditions=1000}) {
  const fail=msg=>{throw new Error(msg)};
  const id=v=>{const s=String(v);if(!/^[1-9]\d{0,9}$/.test(s)||Number(s)>2147483647)fail("Invalid ID");return s};
  const name=v=>{if(typeof v!=="string"||!v.trim()||v.length>250||/https?:\/\/|[\u0000-\u001f]/i.test(v))fail("Invalid display name");return v.trim()};
  const index=(rows,key)=>{if(!Array.isArray(rows)||!rows.length)fail("Empty inventory");const m=new Map();for(const r of rows){const k=id(r[key]);if(m.has(k))fail("Duplicate ID in inventory");m.set(k,r)}return m};
  if(!["events","daily"].includes(mode)||!Number.isInteger(maxAdditions)||maxAdditions<1)fail("Invalid configuration");
  const cats=index(categories,"category_id"), current=index(live,"stream_id"), sourceCats=index(providerCategories,"category_id"), source=index(providerStreams,"stream_id");
  const eventId=id(mappings.eventTarget);
  if(!cats.has(eventId)||id(categories.at(-1).category_id)!==eventId||!/event|ppv/i.test(name(cats.get(eventId).category_name)))fail("Event category must be last");
  const protectedSet=new Set(protectedIds.map(id)), groupMap=new Map();
  for(const [sourceId,targetId] of Object.entries(mappings.groups??{})){const a=id(sourceId),b=id(targetId);if(!cats.has(b))fail("Unknown target category");groupMap.set(a,b)}
  const norm=v=>name(v).normalize("NFKC").toLowerCase().replace(/\s+/g," ");
  const key=(category,title)=>`${category}\u0000${norm(title)}`;
  const names=new Set();
  for(const row of live){const category=id(row.category_id);if(!cats.has(category))fail("Invalid current category");names.add(key(category,row.name))}
  const known=[...current.keys()].filter(k=>!protectedSet.has(k));
  if(known.length===0||known.filter(k=>source.has(k)).length/known.length<0.85)fail("Provider overlap below 85%; refusing incomplete inventory");
  const additions=[], renames=[], pending=[], missing=[];
  for(const [streamId,row] of source){const group=id(row.category_id);if(!sourceCats.has(group))fail("Unknown provider group");const target=groupMap.get(group);const title=name(row.name);
    if(protectedSet.has(streamId))continue;
    const old=current.get(streamId);
    if(old){if(target===eventId&&id(old.category_id)===eventId&&title!==old.name)renames.push({stream_id:Number(streamId),name:title});continue}
    if(!target){pending.push({stream_id:Number(streamId),source_category_id:group,reason:"unmapped_group"});continue}
    if(mode==="events"&&target!==eventId)continue;
    if(target!==eventId&&names.has(key(target,title))){pending.push({stream_id:Number(streamId),source_category_id:group,reason:"possible_duplicate"});continue}
    additions.push({stream_id:Number(streamId),category_id:target,name:title,epg_channel_id:""});names.add(key(target,title));
  }
  for(const [streamId,row] of current)if(!protectedSet.has(streamId)&&!source.has(streamId))missing.push({stream_id:Number(streamId),category_id:id(row.category_id)});
  if(additions.length>maxAdditions||renames.length>maxAdditions)fail("Change cap exceeded");
  return {mode,additions,renames,pending,missing,counts:{current:current.size,provider:source.size},publish:false};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const input = JSON.parse(readFileSync(0, 'utf8')); process.stdout.write(JSON.stringify(planCatalogue(input), null, 2)+'\n'); } catch { console.error('Catalogue planning failed; no changes made.'); process.exitCode=1; }
}
