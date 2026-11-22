import test from "node:test";
import assert from "node:assert/strict";
import {regionalSkyPreferredSource} from "./qa-sky-regional-preferred.mjs";

test("recovers only four Sky Sport NZ sources proven to return TS bytes",()=>{
 for(const [n,id] of [[1,636918],[2,1424317],[3,1424316],[9,636926]]){
  const old={external_id:100+n,provider_stream_id:2024779-n,
   epg_id:"SkySport"+n+".nz",display_name:"Sky Sport "+n,
   logo_url:"https://example.test/icon.png",provider_name:"BEST"};
  const r=regionalSkyPreferredSource(old);
  assert.equal(r.provider_stream_id,id);
  assert.equal(r.external_id,old.external_id);
  assert.equal(r.epg_id,old.epg_id);
  assert.equal(r.logo_url,old.logo_url);
  assert.equal(old.provider_stream_id,2024779-n);
 }
});
test("unverified Sky and all non-Sky/other providers remain untouched",()=>{
 for(const n of [4,5,6,7,8]){
  const item={provider_name:"BEST",display_name:"Sky Sport "+n,provider_stream_id:2024779-n};
  assert.strictEqual(regionalSkyPreferredSource(item),item);
 }
 const foreign={provider_name:"BEST",display_name:"Sky Sports Main Event",provider_stream_id:125};
 assert.strictEqual(regionalSkyPreferredSource(foreign),foreign);
 const alt={provider_name:"OTHER",display_name:"Sky Sport 1",provider_stream_id:555};
 assert.strictEqual(regionalSkyPreferredSource(alt),alt);
});
