import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qaAuHlsVariants,QA_AU_HLS_BASE} from './qa-au-hls-test.mjs';

test('v30: tested Australian BEST source gets isolated M3U8 variant, no original mutation',()=>{
  const rows=[
    {external_id:692,provider_stream_id:646971,category:'Australia',
     provider_name:'BEST',display_name:'FOX SPORTS 501',source_format:'ts',epg_id:'live:au-fox-sports-501'},
    {external_id:2001520176,provider_stream_id:1520176,category:'RAW',subcategory:'AU| AUSTRALIA',
     provider_name:'BEST',display_name:'KAYO - FOX SPORTS 501 CRICKET',source_format:'ts'},
    {external_id:100,provider_stream_id:900000001,category:'New Zealand',provider_name:'MJH NZ',
     display_name:'TVNZ 1',source_format:'mpd'},
    {external_id:733,provider_stream_id:1789688,category:'Australia',
     provider_name:'BEST',display_name:'Ten',source_format:'ts'}
  ];
  const original=JSON.stringify(rows);
  const group=r=>r.category==='Australia'||r.subcategory==='AU| AUSTRALIA'?'Australia':'New Zealand';
  const out=qaAuHlsVariants(rows,group);
  assert.equal(out.length,6);
  assert.deepEqual(out.slice(0,4),rows);
  assert.equal(out[4].external_id,QA_AU_HLS_BASE+646971);
  assert.equal(out[4].source_format,'m3u8');
  assert.equal(out[4].epg_id,'live:au-fox-sports-501');
  assert.equal(out[5].external_id,QA_AU_HLS_BASE+1520176);
  assert.equal(out[5].source_format,'m3u8');
  assert.equal(JSON.stringify(rows),original);
});
test('v30: duplicate source rows not duplicated and other categories excluded',()=>{
  const a={provider_stream_id:646971,provider_name:'BEST',category:'Australia',
    display_name:'FOX SPORTS 501'};
  const b={...a};
  const c={...a,category:'Sports'};
  const r=qaAuHlsVariants([a,b,c],x=>x.category);
  assert.equal(r.length,4);
  assert.equal(r.at(-1).external_id,2050646971);
});
test('v30: HLS requests require real catalogued channel and authorised account',()=>{
 const s=readFileSync(new URL('./n-v22-index.ts',import.meta.url),'utf8');
 assert.match(s,/if\(externalId>=QA_AU_HLS_BASE\)/);
 assert.match(s,/const auth=await catalogueAccountState\(base,u,p\)/);
 assert.match(s,/Number\(r.external_id\)===externalId&&Number\(r.provider_stream_id\)===rawId/);
 assert.match(s,/rawId\+"\.m3u8"/);
 assert.match(s,/rows.splice\(0,rows.length,\.\.\.qaAuHlsVariants\(rows,nuvioGroup\)\)/);
 assert.match(s,/nuvio:full:qa:v11-au-hls-transport/);
});
