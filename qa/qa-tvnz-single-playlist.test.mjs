import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nzSourceForBinding,nzPlaylistLines} from './nz-routing.mjs';

const qa=readFileSync(new URL('./n-v20-index.ts',import.meta.url),'utf8');
const acceptedPrevious=readFileSync(new URL('./n-v18-index.ts',import.meta.url),'utf8');
const prior=readFileSync(new URL('./n-v16-index.ts',import.meta.url),'utf8');
const start='async function releaseM3u(u:string,p:string,url:URL){';
const end='let skyNzShortCache:';
const m3uStart=qa.indexOf(start);
const m3uEnd=qa.indexOf(end,m3uStart);
assert.ok(m3uStart>=0&&m3uEnd>m3uStart,'QA full M3U source is present');

function renderM3u(rows){
  const source=qa.slice(m3uStart,m3uEnd)
    .replace('async function releaseM3u(u:string,p:string,url:URL){','async function releaseM3u(u,p,url){');
  const run=new Function('nuvioFullRows','NUVIO_CATEGORY_LABELS','nuvioGroup','effectiveLiveEpgId',
    'xmlEsc','nzSourceForBinding','nzPlaylistLines','SUPABASE_URL','Response',
    'return ('+source+');');
  const func=run(
    async()=>rows,
    {'New Zealand':'01 🇳🇿 New Zealand','Australia':'02 🇦🇺 Australia','Live Events':'99 🗄️ Sports Event Sources'},
    row=>row.group,
    row=>row.epg_id,
    s=>String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;'),
    nzSourceForBinding,nzPlaylistLines,'https://example.invalid',Response
  );
  return func('testuser','testpass',new URL('https://n.loungetv.nz/get.php?_lounge_host=n.loungetv.nz'));
}
const exemplar=[
  {external_id:1486561,provider_name:'MJH NZ',provider_stream_id:900000001,
    display_name:'TVNZ 1',group:'New Zealand',epg_id:'One.nz',source_format:'mpd'},
  {external_id:1486578,provider_name:'MJH NZ',provider_stream_id:900000002,
    display_name:'TVNZ 2',group:'New Zealand',epg_id:'TV2.nz',source_format:'mpd'},
  {external_id:1486630,provider_name:'MJH NZ',provider_stream_id:900000003,
    display_name:'Three',group:'New Zealand',epg_id:'Three.nz',source_format:'m3u8'},
  {external_id:2001234567,provider_name:'BEST',provider_stream_id:1234567,
    display_name:'Sports event',group:'Live Events',epg_id:'',source_format:'ts'}
];

test('QA v20 removes both incorrect BEST TVNZ routes and restores v18 source exactly',()=>{
 assert.equal(qa,acceptedPrevious);
 assert.doesNotMatch(qa,/TVNZ_BEST_COMPAT_QA|1182156|1182157/);
 assert.match(qa,/if\(nz\) lines\.push\(\.\.\.nzPlaylistLines\(nz\)\)/);
 assert.match(qa,/if\(nz\.drm\) return json\(\{error:"drm_client_required"/);
});

test('QA single M3U keeps the rest of the gateway byte-for-byte unchanged',()=>{
 assert.equal(qa.slice(0,m3uStart),prior.slice(0,prior.indexOf(start)));
 assert.equal(qa.slice(m3uEnd),prior.slice(prior.indexOf(end)));
 assert.doesNotMatch(qa,/qa_tvnz_only/);
 assert.match(qa.slice(m3uStart,m3uEnd),/NUVIO_CATEGORY_LABELS\[nuvioGroup\(r\)\]/);
});

test('one M3U includes TVNZ 1/2 and other live channels with unchanged EPG identities',async()=>{
 const response=await renderM3u(exemplar);
 assert.equal(response.status,200);
 const text=await response.text();
 assert.equal((text.match(/^#EXTINF:/gm)||[]).length,exemplar.length);
 assert.match(text,/TVNZ 1\n#EXTVLCOPT:/);
 assert.match(text,/TVNZ 2\n#EXTVLCOPT:/);
 assert.match(text,/Three\n#EXTVLCOPT:/);
 assert.match(text,/Sports event\nhttps:\/\/n\.loungetv\.nz\/live\/testuser\/testpass\/2001234567\.ts/);
 assert.match(text,/tvg-id="One\.nz"/);
 assert.match(text,/tvg-id="TV2\.nz"/);
 assert.match(text,/x-tvg-url="https:\/\/n\.loungetv\.nz\/xmltv\.php\?username=testuser&password=testpass"/);
 assert.match(text,/group-title="01 🇳🇿 New Zealand"/);
 assert.match(text,/group-title="99 🗄️ Sports Event Sources"/);
});

test('existing Widevine manifest and licence metadata preserved for both channels',async()=>{
 const response=await renderM3u(exemplar);
 const text=await response.text();
 for(const name of ['tvnz-1','tvnz-2']){
   const segment=text.match(new RegExp('TVNZ [12]\\n([\\s\\S]*?)https:\\/\\/i\\.mjh\\.nz/\\.r/'+name+'\\.mpd'));
   assert.ok(segment,'missing Widevine source '+name);
   assert.match(segment[1],/#KODIPROP:inputstream\.adaptive\.license_type=com\.widevine\.alpha/);
   assert.match(segment[1],new RegExp('#KODIPROP:inputstream\\.adaptive\\.license_key=https:\\/\\/c\\.mjh\\.nz/'+name+'-wv'));
 }
});

test('the full M3U is served only after existing account validation',()=>{
 assert.match(qa,/if\(parts\[0\]==="get\.php"\)\{const \{u,p\}=credentials\(url,parts\);const auth=await accountState\(base,u,p\);if\(!auth\.ok\)return json\(\{error:"not_allowed"\},403\)/);
});
