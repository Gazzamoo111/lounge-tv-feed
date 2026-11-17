import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {nuvioChannelPriority} from "./channel-priority.mjs";
import { qaCustomerCategoryLabels, qaCustomerLiveRows } from "./qa-customer-live-presentation.mjs";
const nz = (display_name, id, category="RAW", subcategory="NZ| NEW ZEALAND") => ({
  display_name,provider_name:"BEST",provider_stream_id:id,external_id:2000000000+id,
  category,subcategory,epg_id:"test-epg-"+id,source_format:"ts",logo_url:"https://cdn.invalid/"+id
});
const group = r => r.category==="New Zealand"||String(r.subcategory).startsWith("NZ|")?"New Zealand":"UK TV";

const removed = [
 "TVNZ DUKE HD", "SKY SPORT 10 SELECT HD", "JUICE TV HD",
 "EDEN HD","FIRSTLIGHT HD","MAORI TELEVISION HD","PRIME HD",
 "RUSH HD","SHINE TV HD","TAB TRACKSIDE 1","TAB TRACKSIDE 2",
 "TRACK SIDE 1 HD","TRACK SIDE 2 HD",
 "TVSN SHOPPING HD","WAIRARAPA TV HD",
 "PARLIAMENT TV HD","CH200 HD","CH 200 HD"
];
test("exclude every explicitly unwanted NZ channel, including all Trackside variants",()=>{
  const rows=removed.map((name,i)=>nz(name,51000+i));
  assert.deepEqual(qaCustomerLiveRows(rows,group),[]);
});
test("remove Juice TV duplicated in NZ and other categories",()=>{
  const rows=[nz("JUICE TV HD",62001),nz("JUICE TV",62002,"Music","UK| MUSIC")];
  assert.equal(qaCustomerLiveRows(rows,group).length,0);
});
test("rename only the nine known HD backups and preserve all source and EPG fields",()=>{
 const rows=Array.from({length:9},(_,i)=>({
   ...nz("SKY SPORT "+(i+1)+" HD BACKUP",636918+i,"New Zealand","Sports"),
   epg_id:"SkySport"+(i+1)+".nz"
 }));
 const got=qaCustomerLiveRows(rows,group);
 assert.deepEqual(got.map(r=>r.display_name),Array.from({length:9},(_,i)=>"Sky Sport "+(i+1)));
 assert.deepEqual(got.map(r=>r.provider_stream_id),rows.map(r=>r.provider_stream_id));
 assert.deepEqual(got.map(r=>r.external_id),rows.map(r=>r.external_id));
 assert.deepEqual(got.map(r=>r.epg_id),rows.map(r=>r.epg_id));
 assert.deepEqual(got.map(r=>r.source_format),rows.map(r=>r.source_format));
 assert.deepEqual(got.map(r=>r.logo_url),rows.map(r=>r.logo_url));
});
test("preserve MJH NZ TVNZ, Three, Whakaata Maori, Te Reo and other sports",()=>{
 const rows=[
   nz("TVNZ 1",900000001,"New Zealand","TV"),nz("TVNZ 2",900000002,"New Zealand","TV"),
   nz("Three",900000003,"New Zealand","TV"),nz("Whakaata Māori",900000004,"New Zealand","TV"),
   nz("Te Reo",900000005,"New Zealand","TV"),nz("SKY NZ ESPN",62110,"New Zealand","Sports"),
   nz("SKY SPORT SELECT HD",62111),
   nz("SKY SPORT 1 HD",62113)
 ];
 assert.deepEqual(qaCustomerLiveRows(rows,group),rows);
});
test("NZ removals do not accidentally strip overseas PRIME or channel names containing substrings",()=>{
 const rows=[nz("PRIME HD",4100,"RAW","UK| TV"),nz("PRIME VIDEO CHANNEL",4101,"RAW","NZ| NEW ZEALAND"),nz("RUSH HOUR TV",4102),nz("SHINE ON",4103)];
 assert.deepEqual(qaCustomerLiveRows(rows,group),rows);
});
test("clean 23 categories use unique numeric slots and meaningful category 12",()=>{
 const labels=Object.values(qaCustomerCategoryLabels);
 assert.equal(labels.length,23);
 assert.equal(new Set(labels).size,23);
 for(const x of labels)assert.match(x,/^(?:0[1-9]|1\d|2[0-2]|99) [^\s].+$/);
 assert.equal(qaCustomerCategoryLabels["24/7 Movies & Series"],"12 🍿 24/7 Movies & Series");
 assert.equal(qaCustomerCategoryLabels["New Zealand"],"01 🇳🇿 New Zealand");
 const original=readFileSync(new URL("./n-v21-index.ts",import.meta.url),"utf8");
 const map=original.match(/const NUVIO_CATEGORY_LABELS:Record<string,string>=({[\s\S]*?});/);
 assert.ok(map,"Original category template is present");
 assert.deepEqual(qaCustomerCategoryLabels,JSON.parse(map[1]));
});

test("Te Reo follows Whakaata Māori, before Sky Sport, in the unchanged NZ group",()=>{
 const rows=[...["Sky Sport 3","Te Reo","TVNZ 2","Sky Sport 1","Whakaata Māori","Three","TVNZ 1"]].map((display_name,i)=>nz(display_name,7300+i,"New Zealand","TV"));
 const sorted=[...rows].sort((a,b)=>nuvioChannelPriority("New Zealand",a)-nuvioChannelPriority("New Zealand",b));
 assert.deepEqual(sorted.map(x=>x.display_name),["TVNZ 1","TVNZ 2","Three","Whakaata Māori","Te Reo","Sky Sport 1","Sky Sport 3"]);
 assert.deepEqual(sorted.map(x=>x.provider_stream_id).sort(),rows.map(x=>x.provider_stream_id).sort());
});
