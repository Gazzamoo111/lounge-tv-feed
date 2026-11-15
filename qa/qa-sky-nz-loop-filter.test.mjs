import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {qaSkyNzLoopFilter} from "./qa-sky-nz-loop-filter.mjs";
import {qaSkyOriginalHdBackups} from "./qa-sky-hd-backups.mjs";

const v20=readFileSync(new URL("./n-v20-index.ts",import.meta.url),"utf8");
const v21=readFileSync(new URL("./n-v21-index.ts",import.meta.url),"utf8");
const primary=Array.from({length:9},(_,i)=>({
  external_id:1000+i,display_name:`SKY SPORT ${i+1}`,
  provider_name:"BEST",provider_stream_id:2024778-i,
  category:"New Zealand",subcategory:"Sports"
}));
const curated=Array.from({length:9},(_,i)=>({
  ...primary[i],provider_stream_id:636918+i,epg_id:`SkySport${i+1}.nz`
}));
const inventory=curated.map(row=>({provider_item_id:row.provider_stream_id,is_adult:false}));
const looping=[
  ...Array.from({length:9},(_,i)=>({
    external_id:2001424318-i,provider_stream_id:1424318-i,
    provider_name:"BEST",category:"RAW",subcategory:"NZ| SKY SPORTS NZ",
    display_name:`SKY SPORTS NZ ${i+1}`
  })),
  {external_id:2001424306,category:"RAW",subcategory:"NZ| SKY SPORTS NZ",display_name:"SKY NZ ESPN"},
  {external_id:2001424308,category:"RAW",subcategory:"NZ| SKY SPORTS NZ",display_name:"SKY SPORTS NZ POPUP 1"}
];
const unchanged=[
  {external_id:20,category:"RAW",subcategory:"NZ| SKY SPORT ᴿᴬᵂ",display_name:"SKY SPORT 1 RAW"},
  {external_id:21,category:"Sports",subcategory:"UK Sports",display_name:"SKY SPORTS CRICKET"},
  {external_id:22,category:"New Zealand",display_name:"TVNZ 1",provider_name:"MJH NZ"},
  {external_id:23,category:"New Zealand",display_name:"TVNZ 2",provider_name:"MJH NZ"},
  {external_id:24,category:"New Zealand",display_name:"SKY SPORT POP UP 1",provider_name:"BEST"}
];

test("exclude every looping Sky Sports NZ feed and all nine FHD trial primaries",()=>{
 const backups=qaSkyOriginalHdBackups(primary,curated,inventory);
 assert.equal(backups.length,9);
 const before=[...primary,...looping,...backups,...unchanged];
 const result=qaSkyNzLoopFilter(before);
 assert.equal(result.length,backups.length+unchanged.length);
 assert.equal(result.filter(r=>/^SKY SPORT [1-9]$/.test(r.display_name)).length,0);
 assert.equal(result.filter(r=>r.subcategory==="NZ| SKY SPORTS NZ").length,0);
 assert.equal(before.length-result.length,20);
 assert.deepEqual(result.filter(r=>/HD BACKUP/.test(r.display_name)),backups);
 assert.deepEqual(result.filter(r=>unchanged.includes(r)),unchanged);
});
test("Sky Sport 1-9 HD backups retain provider IDs, EPG and stable external IDs",()=>{
 const result=qaSkyNzLoopFilter([...primary,...qaSkyOriginalHdBackups(primary,curated,inventory)]);
 for(let n=1;n<=9;n++){
   const backup=result.find(r=>r.display_name===`SKY SPORT ${n} HD BACKUP`);
   assert.ok(backup);
   assert.equal(backup.provider_stream_id,636917+n);
   assert.equal(backup.external_id,2000000000+636917+n);
   assert.equal(backup.epg_id,`SkySport${n}.nz`);
 }
});
test("filter leaves inputs unchanged and is not a database or playback mutation",()=>{
 const originals=structuredClone([...primary,...looping,...unchanged]);
 qaSkyNzLoopFilter([...primary,...looping,...unchanged]);
 assert.deepEqual([...primary,...looping,...unchanged],originals);
 assert.match(v21,/rows\.push\(\.\.\.qaSkyOriginalHdBackups\(rows,curated,inventory\)\);\s*[\s\S]*?rows\.splice\(0,rows\.length,\.\.\.qaSkyNzLoopFilter\(rows\)\);/);
 assert.match(v21,/import \{ qaSkyNzLoopFilter \} from "\.\/qa-sky-nz-loop-filter\.mjs"/);
});
test("everything else in v20 including TVNZ source rollback is identical",()=>{
 const baseline=v20.replace('import { qaSkyOriginalHdBackups } from "./qa-sky-hd-backups.mjs";',
 'import { qaSkyOriginalHdBackups } from "./qa-sky-hd-backups.mjs";\nimport { qaSkyNzLoopFilter } from "./qa-sky-nz-loop-filter.mjs";')
 .replace('  rows.push(...qaSkyOriginalHdBackups(rows,curated,inventory));',
 '  rows.push(...qaSkyOriginalHdBackups(rows,curated,inventory));\n  // Remove the looping NZ Sky Sports group and its replaced primaries only\n  // after constructing the nine known-working Sky Sport HD BACKUP rows.\n  rows.splice(0,rows.length,...qaSkyNzLoopFilter(rows));');
 assert.equal(v21,baseline);
 assert.doesNotMatch(v21,/TVNZ_BEST_COMPAT_QA/);
});
