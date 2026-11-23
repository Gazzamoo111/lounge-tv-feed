import test from 'node:test';
import assert from 'node:assert/strict';
import {nzSource,nzKnownStreamIds,nzLicenseRelay} from '../src/nz-live.mjs';

const url=(ch='1')=>new URL('https://xtream-qa.example.test/nz-license.php?ch='+ch);
const challenge=new Uint8Array([1,2,3,4]);
test('approved five NZ sources keep the legacy IDs and verified format shapes',()=>{
 assert.deepEqual(nzKnownStreamIds,[900000001,900000002,900000003,900000004,900000005]);
 assert.equal(nzSource(900000001).url,'https://i.mjh.nz/.r/tvnz-1.mpd');
 assert.equal(nzSource(900000002).drm,'widevine');
 assert.equal(nzSource(900000003).url,'https://i.mjh.nz/.r/three.m3u8');
 assert.equal(nzSource(900000004).url,'https://i.mjh.nz/.r/maori-tv.m3u8');
 assert.equal(nzSource(900000005).url,'https://i.mjh.nz/.r/te-reo.m3u8');
 assert.equal(nzSource(900000006),null);
});
test('relay rejects unsupported channels, wrong methods and large challenges without fetching',async(t)=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('No upstream call expected')});
 assert.equal((await nzLicenseRelay(new Request(url('3'),{method:'POST',body:challenge}),url('3'))).status,404);
 assert.equal((await nzLicenseRelay(new Request(url('1')),url('1'))).status,405);
 assert.equal((await nzLicenseRelay(new Request(url('1'),{method:'POST',body:new Uint8Array(131073)}),url('1'))).status,413);
});
test('relay preserves a normal upstream authorised Widevine challenge response without keys',async(t)=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async(target,options)=>{
  calls++;
  assert.equal(target,'https://c.mjh.nz/tvnz-1-wv');
  assert.equal(options.method,'POST');
  assert.deepEqual(new Uint8Array(options.body),challenge);
  return new Response(new Uint8Array([11,12,13]),{status:200});
 });
 const r=await nzLicenseRelay(new Request(url(),{method:'POST',body:challenge}),url());
 assert.equal(r.status,200);
 assert.deepEqual(new Uint8Array(await r.arrayBuffer()),new Uint8Array([11,12,13]));
 assert.equal(calls,1);
});
test('relay follows only the known signed TVNZ licensing redirect preserving POST challenge',async(t)=>{
 const target='https://fvnz-capi-prod.switch.tv/playback-api/getlicense?auth=x&kid=y&ptoken=z&service=tvnz&version=1';
 let calls=0;
 t.mock.method(globalThis,'fetch',async(targetUrl,opt)=>{
  calls++;
  assert.equal(opt.method,'POST');
  assert.deepEqual(new Uint8Array(opt.body),challenge);
  if(calls===1)return new Response(null,{status:307,headers:{Location:target}});
  assert.equal(targetUrl,target);
  return new Response(new Uint8Array([15,20]),{status:200});
 });
 const r=await nzLicenseRelay(new Request(url('2'),{method:'POST',body:challenge}),url('2'));
 assert.equal(r.status,200);assert.equal(calls,2);
 assert.deepEqual(new Uint8Array(await r.arrayBuffer()),new Uint8Array([15,20]));
});
test('relay rejects arbitrary redirects and propagates upstream refusals',async(t)=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(null,{status:307,headers:{Location:'https://evil.example/challenge'}});
  let r=await nzLicenseRelay(new Request(url(),{method:'POST',body:challenge}),url());
  assert.equal(r.status,502);
  globalThis.fetch=async()=>new Response('Forbidden',{status:403});
  r=await nzLicenseRelay(new Request(url(),{method:'POST',body:challenge}),url());
  assert.equal(r.status,403);
 }finally{globalThis.fetch=original;}
});
