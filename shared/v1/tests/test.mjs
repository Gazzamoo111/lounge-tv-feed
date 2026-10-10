import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRelease} from '../validate.mjs';
import worker from '../api/worker.mjs';
const example={schema:1,revision:'20261010-test-1',generated_at:'2026-10-10T00:00:00Z',
live:{channels:[{id:'nz-1',name:'Sample Channel',artwork:'https://example.org/logo.png'}]},
vod:{titles:[{id:'film-1',name:'Sample Film',type:'movie'}]},
epg:{programmes:[{channel_id:'nz-1',start:'2026-10-10T12:00:00Z',end:'2026-10-10T13:00:00Z',title:'Sample'}]}};
test('valid metadata',()=>assert.equal(validateRelease(example).live_channels,1));
test('blocks credentials',()=>assert.throws(()=>validateRelease({...example,password:'secret'})));
test('blocks direct stream URL',()=>assert.throws(()=>validateRelease({...example,url:'http://test.example/live/user/pass/1.ts'})));
test('blocks duplicate channels',()=>assert.throws(()=>validateRelease({...example,live:{channels:[example.live.channels[0],example.live.channels[0]]}})));
test('inactive by default',async()=>{const r=await worker.fetch(new Request('https://example.org/v1/catalogue'),{});assert.equal(r.status,503);});
test('health is safe',async()=>{const r=await worker.fetch(new Request('https://example.org/v1/health'),{});assert.equal((await r.json()).enabled,false);});


const deviceId = '00000000-0000-4000-8000-000000000001';
const token = 'test-device-token-not-a-secret-00000000001';
const testURL = 'https://staging.invalid/v1/catalogue';
const account = {
  ok: true,
  device: { id: deviceId, status: 'active' },
  subscription: { status: 'active', current_period_end: '2099-12-30T00:00:00Z' },
  service: { status: 'active', expires_at: '2099-12-30T00:00:00Z' },
};
const mockedStorage = {
  async get(key) {
    if (key === 'shared/v1/current.json') {
      return { text: async () => JSON.stringify({ revision: '20261010-demo-1' }) };
    }
    if (key === 'shared/v1/releases/20261010-demo-1/live.json') {
      return {
        httpEtag: '"demo-etag"',
        body: new Response(JSON.stringify({ channels: [{ id: 'demo-1' }] })).body,
      };
    }
    return null;
  },
};
const env = { CONTENT_ENABLED: 'true', CONTENT: mockedStorage,
  SUPABASE_URL: 'https://example.supabase.co' };
const request = (headers = {}) => new Request(testURL, {
  headers: { 'X-Device-Id': deviceId, 'X-Device-Token': token, ...headers },
});
test('enabled API rejects missing credentials before accessing R2', async () => {
  const response = await worker.fetch(new Request(testURL), env);
  assert.equal(response.status, 401);
});
test('enabled API rejects suspended subscription', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    ...account, subscription: { ...account.subscription, status: 'past_due' },
  });
  try {
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 401);
  } finally { globalThis.fetch = originalFetch; }
});
test('authorised device can read private R2 catalogue', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.match(_url, /\/functions\/v1\/device-status$/);
    assert.equal(JSON.parse(options.body).action, 'status');
    return Response.json(account);
  };
  try {
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Lounge-Catalogue-Revision'), '20261010-demo-1');
    assert.equal((await response.json()).channels[0].id, 'demo-1');
  } finally { globalThis.fetch = originalFetch; }
});
test('ETag cannot bypass authentication', async () => {
  const response = await worker.fetch(new Request(testURL, {
    headers: { 'If-None-Match': '"demo-etag"' },
  }), env);
  assert.equal(response.status, 401);
});
test('inactive API does not expose catalogue even to device headers', async () => {
  const response = await worker.fetch(request(), { ...env, CONTENT_ENABLED: 'false' });
  assert.equal(response.status, 503);
});


test('upstream 404 is diagnosed without granting access', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  try {
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'auth_upstream_http_404');
  } finally { globalThis.fetch = originalFetch; }
});
test('transport failure is diagnosed without revealing raw error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('private-test-secret'); };
  try {
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /auth_transport_error/);
    assert.doesNotMatch(body, /private-test-secret/);
  } finally { globalThis.fetch = originalFetch; }
});
