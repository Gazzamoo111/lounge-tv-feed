import test from "node:test";
import assert from "node:assert/strict";
import {qaSkyOriginalHdBackups} from "./qa-sky-hd-backups.mjs";
const curated=Array.from({length:9},(_,i)=>({
  display_name:`SKY SPORT ${i+1}`,provider_name:"BEST",provider_stream_id:636918+i,
  external_id:1000+i,category:"New Zealand",subcategory:"Sports",
  epg_id:i===0?"SkySport1.nz":null,logo_url:"https://example.invalid/icon.png",
  source_format:"ts"
}));
const inventory=curated.map(row=>({provider_item_id:row.provider_stream_id,is_adult:false}));
test("all 9 original HD feeds remain playable as separate stream IDs, same guide and category",()=>{
 const result=qaSkyOriginalHdBackups(curated,curated,inventory);
 assert.equal(result.length,9);
 for(let i=0;i<9;i++){
  assert.equal(result[i].display_name,`SKY SPORT ${i+1} HD BACKUP`);
  assert.equal(result[i].external_id,2000000000+636918+i);
  assert.equal(result[i].provider_stream_id,636918+i);
  assert.equal(result[i].epg_id,`SkySport${i+1}.nz`);
  assert.equal(result[i].category,"New Zealand");
  assert.equal(result[i].logo_url,curated[i].logo_url);
  assert.equal(result[i].source_format,"ts");
 }
});
test("no inventory source, wrong category or duplicate external ID means no extra channel",()=>{
 assert.equal(qaSkyOriginalHdBackups([],curated,[]).length,0);
 const wrong=[{...curated[0],category:"Australia"}];
 assert.equal(qaSkyOriginalHdBackups([],wrong,inventory).length,0);
 const existing=[{external_id:2000636918}];
 assert.equal(qaSkyOriginalHdBackups(existing,[curated[0]],inventory).length,0);
});
test("source inventory and curated rows remain unchanged",()=>{
 const c=structuredClone(curated),i=structuredClone(inventory);
 qaSkyOriginalHdBackups([],curated,inventory);
 assert.deepEqual(curated,c);
 assert.deepEqual(inventory,i);
});
