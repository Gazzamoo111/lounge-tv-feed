import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nzSourceForBinding,nzPlaylistLines } from './nz-routing.mjs';
const v18=readFileSync(new URL('./n-v18-index.ts',import.meta.url),'utf8');
const v19=readFileSync(new URL('./n-v19-index.ts',import.meta.url),'utf8');
const srcA='async function releaseM3u(u:string,p:string,url:URL){',srcB='let skyNzShortCache:';
const clip=(s)=>s.slice(s.indexOf(srcA),s.indexOf(srcB,s.indexOf(srcA)));
const path='/live/'+ 'demo' + '/' + 'secret';
function build(rows){
 let src=clip(v19).replace(srcA,'async function releaseM3u(u,p,url){');
 const factory=new Function('nuvioFullRows','NUVIO_CATEGORY_LABELS','nuvioGroup','effectiveLiveEpgId','xmlEsc','nzSourceForBinding','nzPlaylistLines','SUPABASE_URL','Response','TVNZ_BEST_COMPAT_QA','return ('+src+');');
 const fn=factory(async()=>rows,{'New Zealand':'NZ','Sport':'Sport'},x=>x.group,x=>x.epg_id,x=>String(x||''),nzSourceForBinding,nzPlaylistLines,'https://example.invalid',Response,new Map([[1486561,1182157],[1486578,1182156]]));
 return fn('demo','secret',new URL('https://n.loungetv.nz/get.php?_lounge_host=n.loungetv.nz'));
}
const rows=[
 {external_id:1486561,provider_name:'MJH NZ',provider_stream_id:900000001,display_name:'TVNZ 1',epg_id:'One.nz',group:'New Zealand',source_format:'mpd'},
 {external_id:1486578,provider_name:'MJH NZ',provider_stream_id:900000002,display_name:'TVNZ 2',epg_id:'TV2.nz',group:'New Zealand',source_format:'mpd'},
 {external_id:1486580,provider_name:'MJH NZ',provider_stream_id:900000003,display_name:'Three',epg_id:'Three.nz',group:'New Zealand',source_format:'m3u8'},
 {external_id:2001182313,provider_name:'BEST',provider_stream_id:1182313,display_name:'Sports',epg_id:'Sports.nz',group:'Sport',source_format:'ts'}
];

test('v19 preserves all other catalogue, EPG, and source ordering logic',()=>{
 assert.match(v19,/const TVNZ_BEST_COMPAT_QA=new Map<number,number>\(\[\[1486561,1182157\],\[1486578,1182156\]\]\)/);
 assert.equal((v19.match(/TVNZ_BEST_COMPAT_QA/g)||[]).length,3);
 assert.equal(v19.slice(v19.indexOf('let skyNzShortCache:'),v19.indexOf('if(parts[0]==="live")')),v18.slice(v18.indexOf('let skyNzShortCache:'),v18.indexOf('if(parts[0]==="live")')));
 assert.equal(v19.slice(v19.indexOf('if(parts[0]==="movie"')),v18.slice(v18.indexOf('if(parts[0]==="movie"')));
});
test('same full M3U has two native BEST test routes and preserves remaining sources',async()=>{
 const response=await build(rows),text=await response.text();
 assert.equal(response.status,200);
 assert.equal((text.match(/^#EXTINF/gm)||[]).length,4);
 assert.match(text,new RegExp('TVNZ 1\\nhttps:\\/\\/n\\.loungetv\\.nz'+path+'\\/1486561\\.ts'));
 assert.match(text,new RegExp('TVNZ 2\\nhttps:\\/\\/n\\.loungetv\\.nz'+path+'\\/1486578\\.ts'));
 assert.match(text,/Three\n#EXTVLCOPT:/);
 assert.match(text,/Sports\nhttps:\/\/n\.loungetv\.nz\/live\/demo\/secret\/2001182313\.ts/);
 assert.match(text,/tvg-id="One\.nz"/);
 assert.match(text,/tvg-id="TV2\.nz"/);
 assert.doesNotMatch(text,/tvnz-1\.mpd|tvnz-2\.mpd/);
});
test('Xtream TVNZ 1/2 source switch requires account auth and inventory presence',()=>{
 const live=v19.slice(v19.indexOf('if(parts[0]==="live")'),v19.indexOf('if(parts[0]==="movie"'));
 assert.match(live,/const auth=await catalogueAccountState\(base,u,p\);/);
 assert.match(live,/if\(!auth\.ok\) return json\(\{error:"not_allowed"\},403\)/);
 assert.match(live,/TVNZ_BEST_COMPAT_QA\.get\(externalId\)/);
 assert.match(live,/provider_item_id=\$\{tvnzBest\} and is_present=true/);
 assert.match(live,/return Response\.redirect\(base\+"\/live\/"\+encodeURIComponent\(u\)\+"\/"\+encodeURIComponent\(p\)\+"\/"\+tvnzBest\+"\.ts",302\)/);
 assert.match(live,/if\(nz\.drm\) return json\(\{error:"drm_client_required"/);
});
test('v19 keeps existing full M3U account authentication and no two-channel filter',()=>{
 assert.match(v19,/if\(parts\[0\]==="get\.php"\)\{const \{u,p\}=credentials\(url,parts\);const auth=await accountState\(base,u,p\);if\(!auth\.ok\)return json\(\{error:"not_allowed"\},403\)/);
 assert.doesNotMatch(v19,/qa_tvnz_only/);
});
