import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createCipheriv,randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
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
            if(query.includes('FROM stream_ids'))return args[0]===12345?{stream_id:12345}:null;
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
    return {body:new Blob([bytes]).stream(),text:async()=>typeof value==='string'?value:new TextDecoder().decode(value),size:bytes.byteLength};
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
