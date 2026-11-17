import test from "node:test";
import assert from "node:assert/strict";
import {qaAuVisibleRows} from "./qa-au-duplicates.mjs";
const au=(name,category="RAW",id=0,epg=null,group="Australia")=>({
 display_name:name,category,provider_stream_id:id,epg_id:epg,group
});
const visible=rows=>qaAuVisibleRows(rows,row=>row.group);
test("curated Australian TV and sports channels win over raw variants",()=>{
 const list=[
 au("7flix","Australia",752160),au("AU| 7FLIX PERTH","RAW",752161),
 au("9Gem","Australia",1921314),au("AU: 9NOW 9GEM (NSW) ᴿᴬᵂ","RAW",1921349),
 au("Channel 9","Australia",156905),au("AU: 9NOW CHANNEL 9 (VIC) ᴿᴬᵂ","RAW",1921345),
 au("ESPN Australia","Australia",646974),au("AU| KAYO - ESPN 1","RAW",1520168),
 au("FOX SPORTS 502","Australia",646970),au("AU| KAYO - FOX SPORTS 502 LEAUGE","RAW",1520171),
 au("Fox Sports News Australia","Australia",1520172),au("AU| FOX SPORTS NEWS","RAW",646972),
 au("SBS World Movies","Australia",156873),au("AU| SBS WORLD MOVIES NATIONAL","RAW",156923),
 au("10 Shake","Australia",752176),au("AU| 10 SHAKE HOBART","RAW",752179),
 au("Seven","Australia",738209),au("AU| CHANNEL 7 HD","RAW",738209)
 ];
 assert.deepEqual(visible(list).map(x=>x.provider_stream_id),
  [752160,1921314,156905,646974,646970,1520172,156873,752176,738209]);
});
test("unknown extra channels and distinct channel numbers survive",()=>{
 const list=[
 au("FOX SPORTS 501","Australia",646971),au("FOX SPORTS 502","Australia",646970),
 au("SKY NEWS EXTRA 1","RAW",646959),au("SKY NEWS EXTRA 2","RAW",646958),
 au("AU| NRL EVENT 1","RAW",1234,null,"Live Events"),au("SKY NEWS EXTRA 1","RAW",1812071)
 ];
 assert.deepEqual(visible(list).map(x=>x.provider_stream_id),[646971,646970,646959,646958,1234]);
});
test("prefer national and then Sydney when only regional raw options exist",()=>{
 const rows=[
 au("RACING.COM PERTH","RAW",156876),au("RACING.COM NATIONAL","RAW",156926),
 au("RACING.COM MELBOURNE","RAW",156896),
 au("SKY RACING 1","RAW",646956),au("SKY RACING 1 HD","RAW",646952),
 au("ABC PERTH","RAW",156862),au("ABC SYDNEY","RAW",156899)
 ];
 assert.deepEqual(visible(rows).map(x=>x.provider_stream_id),[156926,646952,156899]);
});
test("does not modify inputs or remove channels outside Australia",()=>{
 const rows=[au("ABC SYDNEY","RAW",156899),au("ABC PERTH","RAW",156862),
  au("ABC SYDNEY","RAW",555,null,"New Zealand"),
  au("ABC PERTH","RAW",556,null,"UK TV")];
 const copy=structuredClone(rows),result=visible(rows);
 assert.deepEqual(result.map(x=>x.provider_stream_id),[156899,555,556]);
 assert.deepEqual(rows,copy);
});
