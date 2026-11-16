import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {qaTvnzXtreamDrmFields} from "./qa-tvnz-xtream-drm.mjs";
const old=readFileSync(new URL("./n-v21-index.ts",import.meta.url),"utf8");
const now=readFileSync(new URL("./n-v22-index.ts",import.meta.url),"utf8");
test("only TVNZ 1 and 2 receive protected DASH metadata",()=>{
 const map=[
  [900000001,"tvnz-1"],[900000002,"tvnz-2"]
 ];
 for(const [id,slug] of map){
   const d=qaTvnzXtreamDrmFields({provider_name:"MJH NZ",provider_stream_id:id});
   assert.equal(d.lounge_drm_scheme,"widevine");
   assert.equal(d.lounge_drm_manifest,"mpd");
   assert.equal(d.lounge_stream_url,`https://i.mjh.nz/.r/${slug}.mpd`);
   assert.equal(d.lounge_drm_license,`https://c.mjh.nz/${slug}-wv`);
   assert.match(d.lounge_stream_user_agent,/otg\/1\.5\.1/);
 }
 for(const r of [
  {provider_name:"MJH NZ",provider_stream_id:900000003},
  {provider_name:"BEST",provider_stream_id:1182156},
  {provider_name:"BEST",provider_stream_id:1182157},
  {provider_name:"BEST",provider_stream_id:636918},
  {provider_name:"MJH NZ",provider_stream_id:0},
  null
 ])assert.deepEqual(qaTvnzXtreamDrmFields(r),{});
});
test("Xtream adds the new fields to the existing full channel response only",()=>{
 const core=old.replace('import { qaSkyNzLoopFilter } from "./qa-sky-nz-loop-filter.mjs";',
   'import { qaSkyNzLoopFilter } from "./qa-sky-nz-loop-filter.mjs";\nimport { qaTvnzXtreamDrmFields } from "./qa-tvnz-xtream-drm.mjs";')
   .replace('custom_sid:"",tv_archive:0,direct_source:"",tv_archive_duration:0\n      })))',
    'custom_sid:"",tv_archive:0,direct_source:"",tv_archive_duration:0,\n        ...qaTvnzXtreamDrmFields(r)\n      })))');
 assert.equal(now,core);
 assert.match(now,/if\(action==="get_live_streams"\)/);
 assert.match(now,/\.\.\.qaTvnzXtreamDrmFields\(r\)/);
 assert.doesNotMatch(now,/TVNZ_BEST_COMPAT_QA/);
 assert.match(now,/rows\.splice\(0,rows\.length,\.\.\.qaSkyNzLoopFilter\(rows\)\)/);
});
