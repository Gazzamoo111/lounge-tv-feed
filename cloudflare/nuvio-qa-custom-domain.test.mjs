import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './nuvio-qa-custom-domain.mjs';
async function call(path, opts={}){
 let sent;
 globalThis.fetch=async req=>{sent=req;return path.startsWith('/live/')?new Response(null,{status:302,headers:{location:'https://example.invalid/live.ts'}}):new Response(JSON.stringify({user_info:{auth:1}}),{status:200,headers:{'Content-Type':'application/json'}})};
 const response=await worker.fetch(new Request('https://n.loungetv.nz'+path,opts));return {response,sent};
}
test('root forwards to QA n function',async()=>{const {response,sent}=await call('/');assert.equal(response.status,200);assert.equal(new URL(sent.url).pathname,'/functions/v1/n/');assert.equal(new URL(sent.url).searchParams.get('_lounge_host'),'n.loungetv.nz')});
test('Xtream authentication path preserves credentials and action',async()=>{const {sent}=await call('/player_api.php?username=test&password=example&action=get_live_categories');const u=new URL(sent.url);assert.equal(u.pathname,'/functions/v1/n/player_api.php');assert.equal(u.searchParams.get('username'),'test');assert.equal(u.searchParams.get('password'),'example');assert.equal(u.searchParams.get('action'),'get_live_categories')});
test('Xtream guide, playlist and category paths forwarded',async()=>{for (const path of ['/get.php?type=m3u_plus','/xmltv.php?username=u','/player_api.php?action=get_live_streams&category_id=1']){const {sent}=await call(path);assert.equal(new URL(sent.url).pathname,'/functions/v1/n'+new URL('https://n.loungetv.nz'+path).pathname)}});
test('playback retains range and location redirect',async()=>{const {sent,response}=await call('/live/u/p/2000234.ts',{headers:{Range:'bytes=0-1023'}});assert.equal(sent.headers.get('Range'),'bytes=0-1023');assert.equal(response.status,302);assert.equal(response.headers.get('Location'),'https://example.invalid/live.ts')});
test('unrelated host rejected',async()=>{let got;globalThis.fetch=async x=>{got=x;return new Response('not expected')};const r=await worker.fetch(new Request('https://connect.loungetv.nz/player_api.php'));assert.equal(r.status,404);assert.equal(got,undefined)});
test('response explicitly prevents caching',async()=>{const {response}=await call('/player_api.php');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Lounge-QA-Route'),'n')});
