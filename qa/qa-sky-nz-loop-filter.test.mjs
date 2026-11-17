import test from "node:test";
import assert from "node:assert/strict";
import {qaSkyNzLoopFilter} from "./qa-sky-nz-loop-filter.mjs";
import {qaSkySwapPrimary} from "./qa-sky-fhd-primary.mjs";
const curated=Array.from({length:9},(_,i)=>qaSkySwapPrimary({
 external_id:1000+i,display_name:"SKY SPORT "+(i+1),
 category:"New Zealand",subcategory:"Sports",
 provider_name:"BEST",provider_stream_id:636918+i,epg_id:"SkySport"+(i+1)+".nz"
}));
test("all nine curated Sky Sport FHD streams remain the customer main channels",()=>{
 const rawHd=curated.map((r,i)=>({...r,category:"RAW",subcategory:"NZ| NEW ZEALAND",
  external_id:2000636918+i,provider_stream_id:636918+i,display_name:"SKY SPORT "+(i+1)+" HD"}));
 const oldBackups=curated.map((r,i)=>({...r,external_id:2000636918+i,
  provider_stream_id:636918+i,display_name:"SKY SPORT "+(i+1)+" HD BACKUP"}));
 const loops=[{category:"RAW",subcategory:"NZ| SKY SPORTS NZ",display_name:"SKY SPORTS NZ 1"}];
 const other=[{category:"New Zealand",display_name:"TVNZ 1",provider_name:"MJH NZ"},
  {category:"New Zealand",display_name:"WHĀKAATA MĀORI",provider_name:"MJH NZ"},
  {category:"New Zealand",display_name:"SKY SPORT POP UP 1",provider_name:"BEST"}];
 const list=[...rawHd,...oldBackups,...curated,...loops,...other];
 const result=qaSkyNzLoopFilter(list);
 assert.equal(result.length,12);
 for(let n=1;n<=9;n++){
  const kept=result.filter(r=>r.display_name==="SKY SPORT "+n);
  assert.equal(kept.length,1);
  assert.equal(kept[0].provider_stream_id,2024779-n);
  assert.equal(kept[0].external_id,1000+n-1);
  assert.equal(kept[0].epg_id,"SkySport"+n+".nz");
 }
 assert.deepEqual(result.slice(-3),other);
 assert.equal(list.length,31);
});
test("do not modify source array or remove unrelated network variants",()=>{
 const rows=[
 {category:"RAW",subcategory:"NZ| SKY SPORT ᴿᴬᵂ",display_name:"SKY SPORT 1 RAW",provider_name:"BEST",provider_stream_id:2024778},
 {category:"RAW",subcategory:"UK| SPORTS",display_name:"SKY SPORTS CRICKET",provider_name:"BEST",provider_stream_id:636918},
 {category:"RAW",subcategory:"NZ| NEW ZEALAND",display_name:"SKY SPORT 1 HD",provider_name:"BEST",provider_stream_id:636918},
 {category:"New Zealand",subcategory:"Sports",display_name:"SKY SPORT 1",provider_name:"BEST",provider_stream_id:2024778}
 ];
 const before=structuredClone(rows),result=qaSkyNzLoopFilter(rows);
 assert.equal(result.length,3);
 assert.equal(result[2].provider_stream_id,2024778);
 assert.deepEqual(rows,before);
});
