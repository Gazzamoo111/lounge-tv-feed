import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createCipheriv,randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildRelease} from '../vod/build.mjs';
import worker,{internal} from '../src/worker.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const ENC=new TextEncoder();
async function mock(){
  const AES=randomBytes(32);const IV=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',AES,IV);
  const plain=Buffer.from(JSON.stringify({username:'testprov1',password:'testprov2'}));
  const crypt=Buffer.concat([cipher.update(plain),cipher.final(),cipher.getAuthTag()]).toString('base64');
  const row={username:'user1',expires_at:Math.floor(Date.now()/1000)+86400,enabled:1,max_connections:1,auth_digest:await internal.digest('very-secret-pepper','user1','customer-pass'),provider_iv:IV.toString('base64'),provider_cipher:crypt};
  const data=new Map([
    ['current.json',JSON.stringify({release:'v1'})],
    ['catalog/live_categories.json',JSON.stringify([{category_id:'1',category_name:'NZ'},{category_id:'2',category_name:'AU'}])],
    ['catalog/live_all.json',JSON.stringify([{stream_id:12345,name:'NZ Test',epg_channel_id:'ltv.test'}])],
    ['catalog/by-category/1.json',JSON.stringify([{stream_id:12345,name:'NZ Test',epg_channel_id:'ltv.test'}])],
    ['catalog/template.m3u','#EXTM3U url-tvg="{{EPG_URL}}"\n#EXTINF:-1 tvg-id="ltv.test",NZ Test\n{{BASE}}/live/{{USER}}/{{PASS}}/12345.ts\n'],
    ['epg/guide.xml.gz',new Uint8Array(gzipSync('<tv><channel id="ltv.test"/></tv>'))],
    ['epg/short/12345.json',JSON.stringify({epg_listings:[{title:'VGVzdA==',start_timestamp:1,stop_timestamp:Math.floor(Date.now()/1000)+86400}]})],
  ]);
  const dbCalls=[];const reads=[];
  const DB={
    prepare(query){
      return {
        bind(...args){
          return {async first(){
            dbCalls.push({query,args});
            if(query.includes('FROM accounts'))return args[0]==='user1'&&args[1]===row.auth_digest&&row.enabled?row:null;
            if(query.includes('FROM stream_ids'))return [12345,900000001,900000002,900000003,900000004,900000005].includes(args[0])?{stream_id:args[0]}:null;
            return null;
          }};
        }
      };
    }
  };
  const ASSETS={async get(key){
    reads.push(key);
    const lookup=key.startsWith('releases/v1/')?key.slice('releases/v1/'.length):key;
    if(!data.has(lookup))return null;
    const value=data.get(lookup);
    const bytes=typeof value==='string'?ENC.encode(value):value;
    return {body:new Blob([bytes]).stream(),text:async()=>typeof value==='string'?value:new TextDecoder().decode(value),json:async()=>JSON.parse(new TextDecoder().decode(bytes)),size:bytes.byteLength};
  }};
  const env={AUTH_PEPPER:'very-secret-pepper',PROVIDER_AES_KEY_BASE64:AES.toString('base64'),UPSTREAM_ORIGIN:'https://provider.example.test',DB,ASSETS};
  return {env,row,data,reads,dbCalls};
}
const req=(p)=>new Request('https://xtream-qa.example.test'+p);
const auth='username=user1&password=customer-pass';
const api=(action='')=>'/player_api.php?'+auth+(action?'&action='+action:'');

test('health public without service configuration',async()=>{
  const resp=await worker.fetch(req('/health'),{});assert.equal(resp.status,200);assert.equal((await resp.json()).status,'ok');
});
test('no assets or catalogues can be fetched without credentials',async()=>{
  const {env,reads}=await mock();
  assert.equal((await worker.fetch(req('/player_api.php?username=bad&password=bad'),env)).status,200);
  assert.equal((await worker.fetch(req('/xmltv.php?username=bad&password=bad'),env)).status,401);
  assert.equal((await worker.fetch(req('/get.php?username=bad&password=bad'),env)).status,401);
  assert.deepEqual(reads,[]);
});
test('Xtream login response includes expiry and SSL server settings',async()=>{
  const {env,row}=await mock();const res=await worker.fetch(req(api()),env);const data=await res.json();
  assert.equal(data.user_info.auth,1);assert.equal(data.user_info.exp_date,String(row.expires_at));
  assert.equal(data.server_info.https_port,'443');assert.equal(data.server_info.server_protocol,'https');
});
test('login expires and revocation stops API and playback immediately',async()=>{
  const {env,row}=await mock();row.expires_at=Math.floor(Date.now()/1000)-1;
  assert.equal((await worker.fetch(req(api()),env)).status,200);
  assert.equal((await worker.fetch(req('/live/user1/customer-pass/12345.ts'),env)).status,401);
  row.expires_at=Math.floor(Date.now()/1000)+86400;row.enabled=0;
  assert.equal((await worker.fetch(req('/live/user1/customer-pass/12345.ts'),env)).status,401);
});
test('category and channels fetch static R2 objects and preserve EPG IDs',async()=>{
  const {env,reads}=await mock();
  const cats=await (await worker.fetch(req(api('get_live_categories')),env)).json();
  assert.deepEqual(cats.map(x=>x.category_name),['NZ','AU']);
  const ch=await (await worker.fetch(req(api('get_live_streams')),env)).json();
  assert.equal(ch[0].epg_channel_id,'ltv.test');
  const one=await worker.fetch(req(api('get_live_streams')+'&category_id=1'),env);
  assert.equal(one.status,200);assert.deepEqual(reads,['current.json','releases/v1/catalog/live_categories.json','current.json','releases/v1/catalog/live_all.json','current.json','releases/v1/catalog/by-category/1.json']);
});
test('XMLTV endpoint decompresses gzipped EPG to standard Xtream XML',async()=>{
  const {env}=await mock();const r=await worker.fetch(req('/xmltv.php?'+auth),env);
  assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/xml/);
  assert.equal(await r.text(),'<tv><channel id="ltv.test"/></tv>');
});
test('get.php dynamically attaches the guide and never outputs provider credentials',async()=>{
  const {env}=await mock();const r=await worker.fetch(req('/get.php?'+auth),env);
  const body=await r.text();
  assert.equal(r.status,200);assert.match(body,/url-tvg="https:\/\/xtream-qa\.example\.test\/xmltv.php\?/);
  assert.match(body,/live\/user1\/customer-pass\/12345\.ts/);
  assert.doesNotMatch(body,/\{\{EPG_URL\}\}/);
  assert.doesNotMatch(body,/provider\.example|testprov1|testprov2/);
});
test('short EPG returns channel matching XMLTV source ID',async()=>{
  const {env}=await mock();const r=await worker.fetch(req(api('get_short_epg')+'&stream_id=12345'),env);
  const b=await r.json();assert.equal(b.epg_listings[0].title,'VGVzdA==');
  assert.deepEqual(await (await worker.fetch(req(api('get_short_epg')+'&stream_id=99999'),env)).json(),{epg_listings:[]});
});
test('validated live stream redirects with only the authenticated customers upstream credentials',async()=>{
  const {env,dbCalls}=await mock();const r=await worker.fetch(req('/live/user1/customer-pass/12345.ts'),env);
  assert.equal(r.status,302);
  assert.equal(r.headers.get('location'),'https://provider.example.test/testprov1/testprov2/12345');
  assert.ok(dbCalls.some(x=>x.query.includes('FROM stream_ids')));
});
test('invalid stream cannot be used as open redirect or to fetch provider credentials',async()=>{
  const {env}=await mock();
  assert.equal((await worker.fetch(req('/live/user1/customer-pass/12346.ts'),env)).status,404);
  assert.equal((await worker.fetch(req('/live/user1/customer-pass/http:%2F%2Fbad.example'),env)).status,404);
  env.UPSTREAM_ORIGIN='http://insecure.example.test';
  // Existing safe default blocks accidental HTTP provider configuration.
  assert.equal((await worker.fetch(req('/live/user1/customer-pass/12345.ts'),env)).status,503);
  env.ALLOW_HTTP_UPSTREAM='true';
  // Unknown source ids remain rejected even with HTTP allowed.
  assert.equal((await worker.fetch(req('/live/user1/customer-pass/12346.ts'),env)).status,404);
  // Unexpected protocols are never allowed, even with the QA opt-in.
  env.UPSTREAM_ORIGIN='javascript:alert(1)';
  assert.equal((await worker.fetch(req('/live/user1/customer-pass/12345.ts'),env)).status,503);
});
test('QA explicit HTTP BEST redirect preserves the approved numeric stream ID and per-account credentials',async()=>{
  const {env}=await mock();
  env.UPSTREAM_ORIGIN='http://provider.example.test:80';
  env.ALLOW_HTTP_UPSTREAM='true';
  const response=await worker.fetch(req('/live/user1/customer-pass/12345.ts'),env);
  assert.equal(response.status,302);
  assert.equal(response.headers.get('location'),'http://provider.example.test/testprov1/testprov2/12345');
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
});

test('QA NZ HLS and DASH stream IDs redirect to verified public sources without BEST credentials',async()=>{
  const {env}=await mock();
  env.ENABLE_NZ_OVERRIDES='true';env.ENABLE_TVNZ_LICENSE_RELAY='true';
  const hls=await worker.fetch(req('/live/user1/customer-pass/900000003.m3u8'),env);
  assert.equal(hls.status,302);
  assert.equal(hls.headers.get('location'),'https://i.mjh.nz/.r/three.m3u8');
  assert.doesNotMatch(hls.headers.get('location'),/testprov1|testprov2/);
  const tvnz=await worker.fetch(req('/live/user1/customer-pass/900000001.mpd'),env);
  assert.equal(tvnz.status,302);
  assert.equal(tvnz.headers.get('location'),'https://i.mjh.nz/.r/tvnz-1.mpd');
});
test('NZ synthetic IDs never fall through to BEST and DRM route fails closed when unconfigured',async()=>{
  const {env}=await mock();
  assert.equal((await worker.fetch(req('/live/user1/customer-pass/900000003.m3u8'),env)).status,503);
  env.ENABLE_NZ_OVERRIDES='true';
  assert.equal((await worker.fetch(req('/live/user1/customer-pass/900000001.mpd'),env)).status,503);
  assert.equal((await worker.fetch(req('/live/user1/customer-pass/900000002.mpd'),env)).status,503);
  assert.equal((await worker.fetch(req('/live/user1/bad/900000003.m3u8'),env)).status,401);
  assert.equal((await worker.fetch(req('/live/user1/customer-pass/900000006.ts'),env)).status,404);
  assert.equal((await worker.fetch(req('/nz-license.php?'+auth+'&ch=1'),env)).status,503);
});
test('NZ Xtream JSON includes customer-authenticated licence details only for known TVNZ IDs',async()=>{
  const {env,data}=await mock();
  env.ENABLE_NZ_OVERRIDES='true';env.ENABLE_TVNZ_LICENSE_RELAY='true';
  data.set('catalog/by-category/1.json',JSON.stringify([{stream_id:900000001,name:'TVNZ 1',container_extension:'mpd'},{stream_id:900000003,name:'Three',container_extension:'m3u8'}]));
  const r=await worker.fetch(req(api('get_live_streams')+'&category_id=1'),env);
  assert.equal(r.status,200);
  const rows=await r.json();
  assert.equal(rows[0].lounge_drm_scheme,'widevine');
  assert.equal(rows[0].lounge_drm_manifest,'mpd');
  assert.equal(rows[0].lounge_drm_license,'https://xtream-qa.example.test/nz-license.php?ch=1&username=user1&password=customer-pass');
  assert.equal(rows[1].lounge_drm_license,undefined);
  assert.equal(rows[1].lounge_stream_url,'https://xtream-qa.example.test/live/user1/customer-pass/900000003.m3u8');
});
test('QA Nuvio optional M3U DRM fallback does not expose other channels',async()=>{
  const {env}=await mock();
  env.NUVIO_M3U_DRM_FALLBACK='true';
  const r=await worker.fetch(req(api('get_live_streams')),env);
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{error:'nuvio_m3u_drm_fallback_required'});
  assert.equal((await worker.fetch(req('/get.php?'+auth),env)).status,200);
  assert.equal((await worker.fetch(req(api('get_live_categories')),env)).status,200);
});
test('NZ Widevine endpoint requires Xtream account and rejects empty challenges',async()=>{
  const {env}=await mock();
  env.ENABLE_NZ_OVERRIDES='true';env.ENABLE_TVNZ_LICENSE_RELAY='true';
  const url='https://xtream-qa.example.test/nz-license.php?ch=1';
  assert.equal((await worker.fetch(new Request(url,{method:'OPTIONS'}),env)).status,204);
  assert.equal((await worker.fetch(new Request(url,{method:'POST',body:new Uint8Array([1])}),env)).status,401);
  const valid=url+'&'+auth;
  assert.equal((await worker.fetch(new Request(valid,{method:'POST',body:new Uint8Array()}),env)).status,400);
  assert.equal((await worker.fetch(new Request(valid,{method:'POST',body:new Uint8Array(131073)}),env)).status,413);
});

test('non GET/HEAD methods and missing bindings fail closed',async()=>{
  const {env}=await mock();
  assert.equal((await worker.fetch(new Request('https://xtream-qa.example.test/player_api.php',{method:'POST'}),env)).status,405);
  assert.equal((await worker.fetch(req(api()),{})).status,503);
});

test('guide-only pointer advances and rolls back without changing the catalogue',async()=>{
  const {env,data}=await mock();
  data.set('current.json',JSON.stringify({release:'v1',epg_release:'v2'}));
  data.set('releases/v2/epg/guide.xml.gz',gzipSync('<tv><channel id="ltv.updated"/></tv>'));
  const newer = await worker.fetch(req('/xmltv.php?'+auth),env);
  assert.match(await newer.text(), /ltv.updated/);
  const catalogue = await worker.fetch(req(api('get_live_streams')),env);
  assert.equal((await catalogue.json())[0].stream_id,12345);
  data.set('current.json',JSON.stringify({release:'v1'}));
  const restored = await worker.fetch(req('/xmltv.php?'+auth),env);
  assert.match(await restored.text(), /ltv.test/);
});
test('short EPG drops expired programmes and computes now-playing at request time',async()=>{
  const {env,data}=await mock();
  const now = Math.floor(Date.now()/1000);
  data.set('epg/short/12345.json',JSON.stringify({epg_listings:[
    {title:'old',start_timestamp:now-60,stop_timestamp:now-30},
    {title:'current',start_timestamp:now-30,stop_timestamp:now+30,now_playing:0},
    {title:'next',start_timestamp:now+30,stop_timestamp:now+60,now_playing:1},
  ]}));
  const response = await worker.fetch(req(api('get_short_epg')+'&stream_id=12345&limit=1'),env);
  assert.deepEqual((await response.json()).epg_listings.map(row=>[row.title,row.now_playing]),[['current',1]]);
});


test('VOD build and all six same-login actions preserve stable identities and require auth',async t=>{
  const tmp=await mkdtemp(join(tmpdir(),'ltv-vod-'));
  t.after(()=>rm(tmp,{recursive:true,force:true}));
  const titles=[1,2,3].map(n=>({
    external_id:2800+n, provider_item_id:6700+n, display_name:'A title '+n,
    file_ext:'mp4', genres:['Action'], overview:'Synopsis', poster_url:'https://art.example/poster.jpg',
  }));
  const shows=titles.map(row=>({...row,external_id:row.external_id+10}));
  const episodes=shows.map(row=>({
    series_external_id:row.external_id, external_id:row.external_id+100,
    provider_item_id:row.provider_item_id+100, file_ext:'mkv', season_number:1,
    episode_number:1, title:'Episode One',
  }));
  assert.deepEqual(await buildRelease({movies:titles,series:shows,episodes},tmp),
    {movie:3,series:3,episodes:3});
  await assert.rejects(buildRelease({movies:[...titles,titles[0]],series:shows,episodes},tmp),/Duplicate title ID/);
  const {env,row,data,reads}=await mock();
  env.ENABLE_VOD='true';
  env.NUVIO_M3U_DRM_FALLBACK='true';
  for(const file of await readdir(tmp,{recursive:true,withFileTypes:true})){
    if(!file.isFile())continue;
    const path=join(file.parentPath,file.name);
    data.set('vod/releases/vapproved/'+path.slice(tmp.length+1),await readFile(path,'utf8'));
  }
  data.set('vod/current.json',JSON.stringify({release:'vapproved'}));
  const routes=[
    ['get_vod_categories','',body=>assert.equal(body[0].category_id,'2810109')],
    ['get_vod_streams','&category_id=2810109',body=>assert.equal(body[0].stream_id,2801)],
    ['get_vod_info','&vod_id=2801',body=>assert.equal(body.movie_data.stream_id,2801)],
    ['get_series_categories','',body=>assert.equal(body[0].category_id,'2820108')],
    ['get_series','',body=>assert.equal(body[0].series_id,2811)],
    ['get_series_info','&series_id=2811',body=>assert.equal(body.episodes['1'][0].id,'2911')],
  ];
  for(const [action,params,check] of routes){
    const response=await worker.fetch(req(api(action)+params),env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    const body=await response.json();
    assert.doesNotMatch(JSON.stringify(body),/provider_item_id|testprov/);
    check(body);
  }
  const live=await worker.fetch(req('/get.php?'+auth),env);
  const before=await live.text();
  assert.equal((await worker.fetch(req(api('get_live_streams')),env)).status,503);
  env.ENABLE_VOD_M3U='true';
  const merged=await (await worker.fetch(req('/get.php?'+auth+'&type=m3u_plus'),env)).text();
  assert.ok(merged.startsWith(before));
  assert.match(merged,/https:\/\/xtream-qa.example.test\/movie\/user1\/customer-pass\/2801.mp4/);
  assert.match(merged,/A title 1 S01E01/);
  assert.doesNotMatch(merged,/testprov|provider.example/);
  for(const [path,upstream] of [['movie/2801.mkv','movie/testprov1/testprov2/6701.mp4'],
    ['series/2911.mkv','series/testprov1/testprov2/6801.mkv']]){
    const [kind,file]=path.split('/');
    const response=await worker.fetch(req(`/${kind}/user1/customer-pass/${file}`),env);
    assert.equal(response.status,302);
    assert.equal(response.headers.get('location'),`https://provider.example.test/${upstream}`);
  }
  assert.equal((await worker.fetch(req('/movie/user1/customer-pass/6701.mp4'),env)).status,404);
  row.enabled=0;
  reads.length=0;
  assert.equal((await (await worker.fetch(req(api('get_series')),env)).json()).user_info.auth,0);
  assert.equal((await worker.fetch(req('/series/user1/customer-pass/2911.mkv'),env)).status,401);
  assert.deepEqual(reads,[]);
});

test('missing or malformed VOD pointer leaves the live fallback available',async()=>{
  const {env,data}=await mock();
  env.ENABLE_VOD='true';
  env.ENABLE_VOD_M3U='true';
  const playlist=await (await worker.fetch(req('/get.php?'+auth),env)).text();
  assert.deepEqual(await (await worker.fetch(req(api('get_vod_categories')),env)).json(),[]);
  data.set('vod/current.json','{"release":"../live"}');
  assert.equal((await worker.fetch(req(api('get_series')),env)).status,503);
  assert.equal(await (await worker.fetch(req('/get.php?'+auth),env)).text(),playlist);
});
