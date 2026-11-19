import test from "node:test";
import assert from "node:assert/strict";
import {masterVisibleOrder} from "./qa-international-architecture.mjs";
import {
 worldRegionCatalog,worldVisibleOrder,worldRegionFor,
 worldCategoryLabels,worldCountryOrder,worldDisplayName
} from "./qa-world-regions.mjs";

test("Every historical International QA category maps to one of exactly 23 regions",()=>{
 assert.equal(worldVisibleOrder.length,23);
 assert.equal(new Set(worldVisibleOrder).size,23);
 const legacy=worldRegionCatalog.flatMap(x=>x.legacy);
 assert.equal(new Set(legacy).size,legacy.length);
 const missing=masterVisibleOrder.filter(x=>!legacy.includes(x));
 assert.deepEqual(missing,[]);
 assert.deepEqual(worldVisibleOrder.slice(0,4),
   ["New Zealand","Australia","UK & Ireland","USA & Canada"]);
 assert.equal(worldRegionFor("Unknown BEST region"),"Other International");
 assert.ok(worldVisibleOrder.every(x=>worldCategoryLabels[x]));
});
test("National channel labels are readable in bundled regions",()=>{
 const checks=[
  ["France","France 24","FR | France 24"],
  ["Germany","ZDF","DE | ZDF"],
  ["UK TV","BBC One","UK | BBC One"],
  ["Ireland","RTÉ One","IE | RTÉ One"],
  ["US TV","ESPN","US | ESPN"],
  ["Canada","CBC News","CA | CBC News"],
  ["India Regional","Star Plus","IN | Star Plus"],
  ["Balkans","Klan TV","BALKANS | Klan TV"],
 ];
 for(const [legacy,name,expected] of checks){
  assert.equal(worldDisplayName({display_name:name},legacy),expected);
 }
 assert.equal(worldDisplayName({display_name:"FR | France 24"}, "France"),
 "FR | France 24");
 assert.equal(worldDisplayName({display_name:"Sky Sport 1"},"New Zealand"),
 "Sky Sport 1");
 assert.equal(worldRegionFor("24/7 Movies"),"24/7 Channels");
 assert.equal(worldRegionFor("24/7 Drama & Crime"),"24/7 Channels");
 assert.equal(worldRegionFor("PPV Source Overflow"),"Live Events & PPV");
});
test("Countries cluster deterministically without changing EPG or provider fields",()=>{
 const source={external_id:123,provider_stream_id:235,epg_id:"Germany.de",
  stream_type:"ts",display_name:"DE | ZDF"};
 const renamed=worldDisplayName(source,"Germany");
 assert.equal(renamed,"DE | ZDF");
 assert.deepEqual(source,{external_id:123,provider_stream_id:235,
  epg_id:"Germany.de",stream_type:"ts",display_name:"DE | ZDF"});
 assert.ok(worldCountryOrder("UK TV")<worldCountryOrder("Ireland"));
 assert.ok(worldCountryOrder("US TV")<worldCountryOrder("Canada"));
 assert.equal(worldRegionFor("New Zealand"),"New Zealand");
 assert.equal(worldRegionFor("Australia"),"Australia");
 assert.equal(worldVisibleOrder.at(-1),"Live Events & PPV");
});
