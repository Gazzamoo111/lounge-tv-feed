import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qaAuBestDirectUrl} from './qa-au-direct-playback.mjs';
const base='http://provider.example.test';
const credentials=['trial-user','trial-pass'];
const provider=(id=646970)=>({category:'Australia',display_name:'FOX SPORTS 502',
  provider_name:'BEST',provider_stream_id:id,external_id:693,source_format:'ts',epg_id:'live:au-fox-sports-502'});
const direct=(r,group='Australia')=>qaAuBestDirectUrl(r,group,base,...credentials);

test('v32: Australian FOX HD and Kayo raw sources directly target BEST provider by provider ID',()=>{
 const fox=provider(646970);
 const kayo={...fox,display_name:'KAYO - FOX SPORTS 502 LEAUGE',category:'RAW',subcategory:'AU| AUSTRALIA',provider_stream_id:1520171};
 const before=JSON.stringify([fox,kayo]);
 assert.equal(direct(fox),'http://provider.example.test/live/trial-user/trial-pass/646970.ts');
 assert.equal(direct(kayo),'http://provider.example.test/live/trial-user/trial-pass/1520171.ts');
 assert.equal(JSON.stringify([fox,kayo]),before);
 assert.equal(direct({...fox,source_format:'m3u8'}),'http://provider.example.test/live/trial-user/trial-pass/646970.m3u8');
});
test('v32: NZ, US, non-BEST and unsupported sources retain the existing Lounge gateway',()=>{
 const fox=provider();
 assert.equal(direct(fox,'New Zealand'),null);
 assert.equal(direct(fox,'Sports Networks'),null);
 assert.equal(direct({...fox,provider_name:'MJH NZ'}),null);
 assert.equal(direct({...fox,provider_stream_id:0}),null);
 assert.equal(direct({...fox,source_format:'mpd'}),null);
 assert.equal(qaAuBestDirectUrl(fox,'Australia',base,'','pw'),null);
 assert.equal(qaAuBestDirectUrl(fox,'Australia','not-a-valid-base',...credentials),null);
});
test('v32: gateway changes M3U only; Xtream and TVNZ DRM endpoints remain unchanged',()=>{
 const s=readFileSync(new URL('./n-v22-index.ts',import.meta.url),'utf8');
 assert.match(s,/import \{ qaAuBestDirectUrl \} from "\.\/qa-au-direct-playback\.mjs";/);
 assert.match(s,/const auDirect=qaAuBestDirectUrl\(r,nuvioGroup\(r\),BEST_BASE,u,p\);/);
 assert.match(s,/else if\(auDirect\)lines\.push\(auDirect\);/);
 assert.match(s,/const mapped:any=await releaseLivePlayback\(externalId\);/);
 assert.match(s,/\.\.\.qaTvnzXtreamDrmFields\(r\)/);
 assert.match(s,/return Response\.redirect\(base\+"\/live\/"/);
 assert.doesNotMatch(s,/QA_AU_HLS_BASE/);
});
