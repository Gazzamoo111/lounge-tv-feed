import test from 'node:test';
import assert from 'node:assert/strict';
import { nuvio247Group as group } from './qa-247-groups.mjs';
import { readFileSync } from 'node:fs';

const snapshot=readFileSync(new URL('./n-v12-index.ts',import.meta.url),'utf8');
test('24/7 provider genres are separated without relying on titles',()=>{
 const cases=[
  ['RAW','24/7 SHOWS VIP','24/7 Series'],['RAW','24/7 CLASSIC SHOWS VIP','24/7 Series'],
  ['RAW','US| CINEMANIA TV SHOWS','24/7 Series'],
  ['RAW','24/7 COMEDY VIP','24/7 Comedy'],
  ['RAW','24/7 DRAMA VIP','24/7 Drama & Crime'],
  ['RAW','24/7 ACTION & ADVENTURE VIP','24/7 Drama & Crime'],
  ['RAW','24/7 CRIME VIP','24/7 Drama & Crime'],
  ['RAW','24/7 REALITY VIP','24/7 Reality'],
  ['RAW','24/7 MOVIES/ACTORS VIP','24/7 Movies'],
  ['RAW','24/7 PRIME VIDEO ᴿᴬᵂ ⁶⁰ᶠᵖˢ','24/7 Streaming'],
  ['RAW','US| NETFLIX ON AIR ᴿᴬᵂ ⁶⁰ᶠᵖˢ','24/7 Streaming'],
  ['RAW','UK| 24/7 MOVIES & SERIES','24/7 Movies & Series'],
  ['RAW','24/7 MOVIES & SERIES','24/7 Movies & Series'],
  ['RAW','24/7 CARTOON VIP','24/7 Kids & Cartoons'],
  ['RAW','24/7 KIDS/FAMILY VIP','24/7 Kids & Cartoons'],
  ['RAW','24/7 DISNEY+ ᴿᴬᵂ','24/7 Kids & Cartoons'],
  ['RAW','24/7 ONEPLAY','24/7 OnePlay'],
  ['24/7','Movies & Series','24/7 Movies & Series'],
  ['24/7','Cartoons','24/7 Kids & Cartoons'],
  ['24/7','Kids & Family','24/7 Kids & Cartoons'],
  ['24/7','OnePlay','24/7 OnePlay'],
  ['ENTERTAINMENT','CINEMANIA TV SHOWS',null],
  ['RAW','UK| GENERAL',null],['SPORTS','24/7 MOVIES & SERIES',null]
 ];
 for(const [cat,sub,want] of cases)assert.equal(group(cat,sub),want,cat+' '+sub);
});
test('old category IDs do not shift and sports events stay 99 last',()=>{
 const ids=Object.fromEntries(
   [...snapshot.matchAll(/"([^"]+)"[^\n,]+/g)].slice(0,0)
 );
 const arr=snapshot.match(/const NUVIO_GROUPS=\[([\s\S]*?)\];/)?.[1]?.match(/"[^"]+"/g)?.map(x=>x.slice(1,-1));
 assert.ok(arr);
 assert.deepEqual(arr.slice(0,16),[
  'New Zealand','Australia','Sports Networks','UK TV','US TV',
  'Entertainment & Streaming','News','Movie Channels','Documentaries & Lifestyle',
  'Kids & Family','Music','24/7 Movies & Series','24/7 Kids & Cartoons',
  '24/7 OnePlay','International TV','Live Events'
 ]);
 assert.equal(arr.indexOf('Live Events'),15);
 assert.equal(arr.length,22);
 assert.match(snapshot,/return String\(1800101\+\(n<0\?14:n\)\)/);
 assert.match(snapshot,/"Live Events":"99 /);
});
test('source lookup and Xtream routing use same grouping with stable streams',()=>{
 assert.match(snapshot,/import \{ nuvio247Group \} from "\.\/qa-247-groups\.mjs"/);
 assert.match(snapshot,/const g247=nuvio247Group\(t,v\);/);
 assert.match(snapshot,/if\(g247\)return g247;/);
 assert.match(snapshot,/const rows=await nuvioFullRows\(\);/);
 assert.match(snapshot,/category_id:nuvioGroupId\(nuvioGroup\(r\)\)/);
 assert.match(snapshot,/stream_id:Number\(r\.external_id\)/);
 assert.match(snapshot,/const visible=filtered;/);
 assert.match(snapshot,/LIVE_XMLTV_URL/);
});
