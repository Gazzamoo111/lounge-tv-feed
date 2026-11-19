import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {regionalSkyPreferredSource} from "./qa-sky-regional-preferred.mjs";
const source=readFileSync(new URL("./index.ts",import.meta.url),"utf8");
test("QA edge serves its own /lounge-plus-qa prefix",()=>{
  assert(source.includes('const marker="/lounge-plus-qa";'));
  assert(!source.includes('const marker="/n";'));
});
test("Xtream live catalogue exposes the same 20 category IDs as M3U",()=>{
  assert(source.includes('if(action==="get_live_streams"){'));
  assert(source.includes('const mapped=plusRows(await nuvioFullRows(),nuvioGroup);'));
  assert(source.includes('category_id:PLUS_IDS[group]'));
  assert(!source.includes('nuvio_m3u_drm_fallback_required'));
});
test("Sky Sport 1,2,3,9 use tested source IDs; unknown 4-8 unchanged",()=>{
 const known={1:636918,2:1424317,3:1424316,9:636926};
 for(let i=1;i<=9;i++){
  const input={provider_name:"BEST",display_name:"SKY SPORT "+i,provider_stream_id:2024779-i,external_id:i,epg_id:"SkySport"+i+".nz"};
  const out=regionalSkyPreferredSource(input);
  assert.equal(out.provider_stream_id,known[i]||input.provider_stream_id);
  assert.equal(out.external_id,input.external_id);
  assert.equal(out.epg_id,input.epg_id);
 }
});
test("TVNZ M3U DRM and active NZ/AU routing preserved",()=>{
 assert(source.includes('nzPlaylistLines(nz)'));
 assert(source.includes('qaTvnzXtreamDrmFields(r)'));
 assert(source.includes('if(nz.drm) return json({error:"drm_client_required"'));
});
