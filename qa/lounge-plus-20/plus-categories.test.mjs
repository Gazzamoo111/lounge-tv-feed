import test from "node:test";
import assert from "node:assert/strict";
import {PLUS_ORDER, PLUS_LABELS, PLUS_IDS,plusCategory,plusRows} from "./plus-categories.mjs";
test("20 labelled, numbered, unique categories; no Asia Sports or News",()=>{
 assert.equal(PLUS_ORDER.length,20);
 assert.equal(new Set(PLUS_ORDER).size,20);
 assert(!PLUS_ORDER.some(x=>/Asia Sports|^News$/i.test(x)));
 assert.deepEqual(PLUS_ORDER.map(x=>PLUS_LABELS[x].slice(0,2)),Array.from({length:20},(_,i)=>String(i+1).padStart(2,"0")));
 assert.equal(new Set(Object.values(PLUS_IDS)).size,20);
});
test("UK and US TV/sports classified by provider provenance",()=>{
 const r=(source,cat="RAW")=>({subcategory:source,category:cat,display_name:"Test Channel",external_id:7,epg_id:"test",provider_stream_id:8});
 assert.equal(plusCategory(r("UK| GENERAL"),"UK TV"),"UK TV");
 assert.equal(plusCategory(r("UK| SPORTS"),"Sports Networks"),"UK Sports");
 assert.equal(plusCategory(r("US| CBS NETWORK"),"US TV"),"US TV");
 assert.equal(plusCategory(r("US| SPORTS NETWORK"),"Sports Networks"),"US Sports");
 assert.equal(plusCategory(r("US| NEWS NETWORK"),"News"),"US TV");
});
test("Six preserved 24/7 genres and removed category merges",()=>{
 const r=(name="Example")=>({subcategory:"24/7 Movies & Series",display_name:name});
 const check=[
   ["24/7 Movies","24/7 Movies"],["24/7 Series","24/7 Series"],
   ["24/7 Comedy","24/7 Comedy & Reality"],["24/7 Reality","24/7 Comedy & Reality"],
   ["24/7 Drama & Crime","24/7 Drama & Crime"],
   ["24/7 Streaming","24/7 Streaming & OnePlay"],["24/7 OnePlay","24/7 Streaming & OnePlay"],
   ["24/7 Kids & Cartoons","24/7 Kids & Cartoons"],
   ["24/7 Movies & Series","24/7 Series"]
 ];
 for(const [old,expected] of check)assert.equal(plusCategory(r(),old),expected,old);
 assert.equal(plusCategory(r("24/7 ACTION MOVIES"),"24/7 Movies & Series"),"24/7 Movies");
});
test("no channels removed, duplicates or source metadata changed by presentation mapping",()=>{
 const originals=[
   {external_id:102,epg_id:"a",provider_stream_id:8,display_name:"US Sport",category:"RAW",subcategory:"US| SPORTS NETWORK"},
   {external_id:103,epg_id:"b",provider_stream_id:9,display_name:"UK General",category:"RAW",subcategory:"UK| GENERAL"},
   {external_id:104,epg_id:"c",provider_stream_id:10,display_name:"France",category:"RAW",subcategory:"FR| GENERAL"},
   {external_id:105,epg_id:"d",provider_stream_id:11,display_name:"24/7 FOX",category:"RAW",subcategory:"24/7 SHOWS VIP"}
 ];
 const classified=plusRows(originals,x=>x.external_id===105?"24/7 Series":x.external_id===104?"International TV":x.external_id===103?"UK TV":"Sports Networks");
 assert.equal(classified.length,originals.length);
 assert.deepEqual(classified.map(x=>x.row.external_id).sort(),originals.map(x=>x.external_id).sort());
 for(const x of classified)assert.strictEqual(originals.find(r=>r.external_id===x.row.external_id),x.row);
 assert(classified.every(x=>PLUS_ORDER.includes(x.group)));
});
