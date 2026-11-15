import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Guard only the QA Xtream routing policy. These are source regressions, not
// end-to-end playback or evidence that an upstream media stream is healthy.
const src = readFileSync(new URL('./n-v16-index.ts', import.meta.url), 'utf8');
const liveStart = src.indexOf('if(parts[0]==="live"){');
const vodStart = src.indexOf('if(parts[0]==="movie"||parts[0]==="series"){', liveStart);
assert.ok(liveStart >= 0 && vodStart > liveStart, 'expected live route must exist');
const live = src.slice(liveStart, vodStart);

test('DRM-protected non-BEST source is rejected before ordinary live redirect', () => {
  const nonBest = live.indexOf('if(mapped.provider_name!=="BEST"){');
  const guard = live.indexOf('if(nz.drm) return json({error:"drm_client_required"', nonBest);
  const ordinaryRedirect = live.indexOf('const ext=String(mapped.source_format', nonBest);
  assert.ok(nonBest >= 0 && guard > nonBest && ordinaryRedirect > guard);
  assert.match(live.slice(nonBest, ordinaryRedirect), /drm_client_required[^\n]*422/);
  assert.match(live.slice(nonBest, ordinaryRedirect), /if\(!auth\.ok\) return json\(\{error:"not_allowed"\},403\)/);
});

test('raw BEST overlay requires account authorisation and channel presence', () => {
  const rawStart = live.indexOf('if(externalId>=NUVIO_STREAM_BASE){');
  const curatedStart = live.indexOf('const mapped:any=await releaseLivePlayback(externalId);', rawStart);
  assert.ok(rawStart >= 0 && curatedStart > rawStart);
  const raw = live.slice(rawStart, curatedStart);
  assert.match(raw, /if\(!auth\.ok\)return json\(\{error:"not_allowed"\},403\)/);
  assert.match(raw, /if\(!found\)return json\(\{error:"not_allowed"\},403\)/);
  assert.match(raw, /Response\.redirect\(base\+"\/live\/"/);
  assert.doesNotMatch(raw, /drm_client_required/);
});

test('curated BEST source still uses provider stream ID, not a DRM placeholder', () => {
  const selected = live.slice(live.indexOf('const mapped:any=await releaseLivePlayback(externalId);'));
  assert.match(selected, /if\(!mapped\) return json\(\{error:"not_allowed"\},403\)/);
  assert.match(selected, /Number\(mapped\.provider_stream_id\)/);
  assert.match(selected, /Response\.redirect\(base\+"\/live\/"/);
});

test('only active catalogue release is used for curated playback', () => {
  assert.match(src, /from lounge_delivery\.catalogue_releases\s+where state='active'/);
  assert.match(src, /join lounge_delivery\.live_source_bindings b[\s\S]*?b\.source_role='primary'/);
});
