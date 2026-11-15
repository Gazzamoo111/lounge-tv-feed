import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const old=readFileSync(new URL('./n-v16-index.ts',import.meta.url),'utf8');
const qa=readFileSync(new URL('./n-v17-index.ts',import.meta.url),'utf8');
const routing=readFileSync(new URL('./nz-routing.mjs',import.meta.url),'utf8');

test('v17 changes only the opt-in M3U function, never Xtream, EPG, or playback routes',()=>{
 const begin='async function releaseM3u(u:string,p:string,url:URL){';
 const end='let skyNzShortCache:';
 assert.equal(qa.slice(0,qa.indexOf(begin)),old.slice(0,old.indexOf(begin)));
 assert.equal(qa.slice(qa.indexOf(end)),old.slice(old.indexOf(end)));
 assert.match(qa, /const tvnzQaOnly=url\.searchParams\.get\("qa_tvnz_only"\)==="1"/);
 assert.match(qa, /if\(parts\[0\]==="get\.php"\)/);
 assert.match(qa, /return await releaseM3u\(u,p,url\)/);
});

test('QA-only M3U includes exactly the TVNZ 1 and 2 MJH bindings, otherwise fails closed',()=>{
 assert.match(qa, /r\.provider_name==="MJH NZ" && \[900000001,900000002\]\.includes\(Number\(r\.provider_stream_id\)\)/);
 assert.match(qa, /rows\.length!==2 \|\| new Set\(rows\.map\(\(r:any\)=>Number\(r\.provider_stream_id\)\)\)\.size!==2/);
 assert.match(qa, /qa_tvnz_sources_unavailable/);
 assert.match(qa, /\(DRM QA\)/);
});

test('QA route uses existing account validation and same licensed metadata as full M3U',()=>{
 assert.match(qa, /if\(parts\[0\]==="get\.php"\)\{const \{u,p\}=credentials\(url,parts\);const auth=await accountState\(base,u,p\);if\(!auth\.ok\)return json\(\{error:"not_allowed"\},403\)/);
 assert.match(qa, /if\(nz\) lines\.push\(\.\.\.nzPlaylistLines\(nz\)\)/);
 assert.match(routing, /900000001, \{ slug: 'tvnz-1', format: 'mpd', drm: 'widevine' \}/);
 assert.match(routing, /900000002, \{ slug: 'tvnz-2', format: 'mpd', drm: 'widevine' \}/);
 assert.match(routing, /#KODIPROP:inputstream\.adaptive\.license_type=com\.widevine\.alpha/);
 assert.match(routing, /#KODIPROP:inputstream\.adaptive\.license_key=\$\{source\.license\}/);
});
