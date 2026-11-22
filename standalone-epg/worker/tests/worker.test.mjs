import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

function mock(){
  const bytes=new Uint8Array([31,139,8,0]);
  const store={got:[],async get(key){this.got.push(key);return {body:bytes,size:bytes.length,httpEtag:'"abc123"'};}};
  return {store,env:{EPG_BUCKET:store,EPG_READ_TOKEN:'test-secret-only',GUIDE_OBJECT_KEY:'guides/current.xml.gz'}};
}
const req=(path,opts={})=>new Request('https://epg.example.test'+path,opts);

test('health responds without login or database',async()=>{
  const r=await worker.fetch(req('/health'),{});
  assert.equal(r.status,200);assert.equal((await r.json()).status,'ok');
});
test('rejects unauthenticated and invalid paths before reading R2',async()=>{
  const {env,store}=mock();
  assert.equal((await worker.fetch(req('/guide.xml.gz'),env)).status,404);
  assert.equal((await worker.fetch(req('/guide.xml.gz?key=bad'),env)).status,404);
  assert.equal((await worker.fetch(req('/not-the-guide?key=test-secret-only'),env)).status,404);
  assert.equal(store.got.length,0);
});
test('returns the raw gzip bytes to Nuvio',async()=>{
  const {env,store}=mock();
  const r=await worker.fetch(req('/guide.xml.gz?key=test-secret-only'),env);
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/gzip');
  assert.equal(r.headers.get('content-encoding'),null);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[31,139,8,0]);
  assert.deepEqual(store.got,['guides/current.xml.gz']);
});
test('HEAD and conditional ETag',async()=>{
  const {env}=mock();const url='/guide.xml.gz?key=test-secret-only';
  const a=await worker.fetch(req(url,{method:'HEAD'}),env);
  assert.equal(a.status,200);assert.equal(a.body,null);
  const b=await worker.fetch(req(url,{headers:{'If-None-Match':'"abc123"'}}),env);
  assert.equal(b.status,304);assert.equal(b.body,null);
});
test('missing storage or storage exception returns private 503',async()=>{
  const u=req('/guide.xml.gz?key=test-secret-only');
  assert.equal((await worker.fetch(u,{EPG_READ_TOKEN:'test-secret-only'})).status,503);
  const {env}=mock();env.EPG_BUCKET.get=async()=>{throw Error('internal storage details');};
  const r=await worker.fetch(u,env);assert.equal(r.status,503);
  assert.doesNotMatch(await r.text(),/internal/);
});
test('rejects POST without contacting storage',async()=>{
  const {env,store}=mock();
  assert.equal((await worker.fetch(req('/guide.xml.gz?key=test-secret-only',{method:'POST'}),env)).status,405);
  assert.equal(store.got.length,0);
});
