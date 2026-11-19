import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {regionalSkyPreferredSource} from "./qa-sky-regional-preferred.mjs";
import {qaSkyNzLoopFilter} from "./qa-sky-nz-loop-filter.mjs";
const source=readFileSync(new URL("./index.ts",import.meta.url),"utf8");
test("QA edge serves its own /lounge-plus-qa prefix",()=>{
  assert(source.includes('const marker="/lounge-plus-qa";'));
  assert(!source.includes('const marker="/n";'));
});
test("Xtream login uses the proven 19 Nov Widevine-aware automatic fallback",()=>{
  assert(source.includes('if(action==="get_live_streams"){'));
  assert(source.includes('nuvio_m3u_drm_fallback_required'));
  assert(source.includes('Retry get.php on this server'));
  assert(source.includes('const rows=plusRows(await nuvioFullRows(),nuvioGroup);'));
  assert(source.includes('const group=PLUS_LABELS[plusGroupName];'));
  assert(source.includes('category_id:PLUS_IDS[g]'));
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

test("Sky Sport 1 and 9 source substitution stays visible, raw HD backup hidden",()=>{
 for(const n of [1,9]){
  const source=n===1?636918:636926;
  const curated={provider_name:"BEST",category:"New Zealand",subcategory:"Sports",display_name:"SKY SPORT "+n,external_id:1900+n,provider_stream_id:source};
  const backup={...curated,display_name:"SKY SPORT "+n+" HD BACKUP",external_id:2000000000+source};
  const shown=qaSkyNzLoopFilter([curated,backup]);
  assert.deepEqual(shown,[curated]);
 }
});
