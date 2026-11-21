import test from "node:test";
import assert from "node:assert/strict";
import {qaSkyOriginalHdBackups as standardBackups} from "../production/n/qa-sky-hd-backups.mjs";
import {qaSkyNzLoopFilter as standardFilter} from "../production/n/qa-sky-nz-loop-filter.mjs";
import {qaCustomerLiveRows as standardPresentation} from "../production/n/qa-customer-live-presentation.mjs";
import {qaSkyOriginalHdBackups as plusBackups} from "../production/plus/qa-sky-hd-backups.mjs";
import {qaSkyNzLoopFilter as plusFilter} from "../production/plus/qa-sky-nz-loop-filter.mjs";
import {qaCustomerLiveRows as plusPresentation} from "../production/plus/qa-customer-live-presentation.mjs";

const hdId=n=>636917+n;
const fhdId=n=>2024779-n;
const curated=Array.from({length:9},(_,i)=>({
  category:"New Zealand",subcategory:"Sports",provider_name:"BEST",
  display_name:`SKY SPORT ${i+1}`,provider_stream_id:hdId(i+1),
  external_id:100+i,epg_id:`SkySport${i+1}.nz`,logo_url:"sky-logo",source_format:"ts",
}));
const inventory=Array.from({length:9},(_,i)=>({provider_item_id:hdId(i+1),is_adult:false}));
const groupOf=r=>r.category;

function runPipeline(primaries,createBackups,filter,presentation){
  const rows=[...primaries];
  rows.push(...createBackups(rows,curated,inventory));
  rows.push({category:"RAW",subcategory:"NZ| SKY SPORTS NZ",provider_name:"BEST",
    display_name:"SKY SPORT 2",provider_stream_id:hdId(2),external_id:2000000000+hdId(2)});
  rows.push({category:"RAW",subcategory:"NZ| SKY SPORT RAW",provider_name:"BEST",
    display_name:"SKY SPORT 3 HD",provider_stream_id:hdId(3),external_id:2000000000+hdId(3)});
  return presentation(filter(rows),groupOf);
}

test("standard exposes one distinguishable HD alternative per FHD main, without changing IDs",()=>{
 const mains=curated.map(r=>({...r,provider_stream_id:fhdId(Number(r.display_name.slice(-1)))}));
 const output=runPipeline(mains,standardBackups,standardFilter,standardPresentation);
 assert.equal(output.length,18);
 for(let n=1;n<=9;n++){
  const main=output.find(r=>r.display_name===`SKY SPORT ${n}`);
  const backup=output.find(r=>r.display_name===`SKY SPORT ${n} HD BACKUP`);
  assert.ok(main);assert.ok(backup);
  assert.equal(main.provider_stream_id,fhdId(n));
  assert.equal(main.external_id,99+n);
  assert.equal(backup.provider_stream_id,hdId(n));
  assert.equal(backup.external_id,2000000000+hdId(n));
  assert.equal(backup.epg_id,main.epg_id);
  assert.equal(backup.logo_url,main.logo_url);
 }
 assert.equal(output.some(r=>r.category==="RAW"),false);
});

test("Plus keeps existing HD 1/9 and regional 2/3; offers HD alternatives only for different selected source",()=>{
 const mains=curated.map(r=>{
  const n=Number(r.display_name.slice(-1));
  const selected=(n===1||n===9)?hdId(n):(n===2?1424317:(n===3?1424316:fhdId(n)));
  return {...r,provider_stream_id:selected};
 });
 const output=runPipeline(mains,plusBackups,plusFilter,plusPresentation);
 assert.equal(output.length,16); // 9 curated plus distinct HD alternatives 2–8
 for(let n=1;n<=9;n++){
  const main=output.find(r=>r.display_name===`SKY SPORT ${n}`);
  assert.ok(main);
  assert.equal(main.external_id,99+n);
  const backups=output.filter(r=>r.display_name===`SKY SPORT ${n} HD BACKUP`);
  assert.equal(backups.length,(n===1||n===9)?0:1);
  if(backups.length)assert.equal(backups[0].provider_stream_id,hdId(n));
 }
 assert.equal(output.some(r=>r.category==="RAW"),false);
});

test("does not expose backup without a separate curated main or BEST source",()=>{
 const mains=curated.slice(1).map(r=>({...r,provider_stream_id:fhdId(Number(r.display_name.slice(-1)))}));
 const a=standardBackups(mains,curated,inventory);
 assert.equal(a.some(r=>r.display_name==="SKY SPORT 1 HD BACKUP"),false);
 const noInventory=standardBackups(mains,curated,[]);
 assert.deepEqual(noInventory,[]);
});
