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
 // The customer-facing QA cleanup is a presentation-only overlay.
 // Reverse the permitted edits before asserting that TVNZ Xtream DRM remains the
 // only change relative to the earlier verified gateway.
 const marker='const NUVIO_CATEGORY_LABELS:Record<string,string>=';
 const mapStart=core.indexOf(marker);
 const mapEnd=core.indexOf('\nasync function nuvioLiveCategories',mapStart);
 assert.ok(mapStart>=0 && mapEnd>mapStart,"Expected original category map");
 const originalMap=core.slice(mapStart,mapEnd);
 const equivalent=now
   .replace('import { qaCustomerLiveRows, qaCustomerCategoryLabels } from "./qa-customer-live-presentation.mjs";\n','')
   .replace('  // Customer-facing NZ TV cleanup. Never alter tested stream IDs or TVNZ DRM.\n  rows.splice(0,rows.length,...qaCustomerLiveRows(rows,nuvioGroup));\n','')
   .replace('const NUVIO_CATEGORY_LABELS:Record<string,string>=qaCustomerCategoryLabels;',originalMap)
   .replaceAll('nuvio:full:qa:v7-customer-labels','nuvio:full:qa:v6-epg')
   .replaceAll('nuvio:full:qa:v8-ranked-guide','nuvio:full:qa:v6-epg')
   .replaceAll('nuvio:full:qa:v9-sports-overflow','nuvio:full:qa:v6-epg')
   .replaceAll('nuvio:full:qa:v10-au-integrity','nuvio:full:qa:v6-epg')
   .replace('import { qaAuWrongGuide } from "./qa-au-integrity.mjs";\n','')
   .replace('import { qaAuBestDirectUrl } from "./qa-au-direct-playback.mjs";\\n','')
   .replace(`    // QA: restore Australia's original BEST direct playback, bypassing the
    // HTTPS -> HTTP redirect known to fail on some Android media stacks.
    const auDirect=qaAuBestDirectUrl(r,nuvioGroup(r),BEST_BASE,u,p);
    if(nz) lines.push(...nzPlaylistLines(nz));
    else if(auDirect)lines.push(auDirect);
    else lines.push(base+"/live/"+encodeURIComponent(u)+"/"+encodeURIComponent(p)+"/"+Number(r.external_id)+"."+String(r.source_format||"ts"));`,
   `    if(nz) lines.push(...nzPlaylistLines(nz));
    else lines.push(base+"/live/"+encodeURIComponent(u)+"/"+encodeURIComponent(p)+"/"+Number(r.external_id)+"."+String(r.source_format||"ts"));`)
   .replace('  // Ten is not 10 Bold. Do not display another network’s programmes.\n  if(qaAuWrongGuide(row))return "";\n','')
   .replace('  if(qaAuWrongGuide(mapped))return []; // no Ten->10 Bold nor unverified provider fallback\n','')
   .replace('const gstream=nuvioStreamingGroup(t,v,String(r.display_name||""));','const gstream=nuvioStreamingGroup(t,v);')
   .replace('shortEpgCache.set(key,{until:Date.now()+10*60*1000,list:list||[]});',
            'shortEpgCache.set(key,{until:Date.now()+10*60*1000,list});')
   .replace('  if(!list)return null;\n  const now=Math.floor(Date.now()/1000);',
            '  const now=Math.floor(Date.now()/1000);');
 // v27 deliberately changes ONLY the EPG-aware sorting block in the full catalogue.
 // Normalize that single block to the locked pre-v27 implementation before
 // comparing every other byte of the playback gateway and protected TVNZ logic.
 const sortStart='  // QA EPG recovery:';
 const sortEnd='  catalogueCache.set(k,';
 const block=(text)=>{
   const from=text.indexOf(sortStart),to=text.indexOf(sortEnd,from);
   assert.ok(from>=0&&to>from,'Expected bounded catalogue ranking block');
   return text.slice(from,to);
 };
 const originalRanking=block(core),v27Ranking=block(equivalent);
 assert.match(v27Ranking,/currentGuideIds/);
 assert.match(v27Ranking,/nuvioChannelPriority\(groupA,a,currentGuideIds.has/);
 // The v29 AU guard lives immediately before the permitted ranking overlay.
 // Normalize exactly that bounded extra statement; all other paths stay locked.
 const safeCore=equivalent.replace('  // QA v29: strip the provably wrong Ten->10 Bold guide in the customer list.\n  for(const row of rows)if(qaAuWrongGuide(row))row.epg_id="";\n','');
 const safeRanking=block(safeCore);
 assert.equal(safeCore.replace(safeRanking,originalRanking),core);
 assert.ok(now.includes('const gstream=nuvioStreamingGroup(t,v,String(r.display_name||""));'));
 assert.match(now,/if\(action==="get_live_streams"\)/);
 assert.match(now,/\.\.\.qaTvnzXtreamDrmFields\(r\)/);
 assert.doesNotMatch(now,/TVNZ_BEST_COMPAT_QA/);
 assert.match(now,/rows\.splice\(0,rows\.length,\.\.\.qaSkyNzLoopFilter\(rows\)\)/);
});
