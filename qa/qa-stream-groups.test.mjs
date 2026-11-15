import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nuvioStreamingGroup as group } from './qa-stream-groups.mjs';
const v12=readFileSync(new URL('./n-v12-index.ts',import.meta.url),'utf8');
const v13=readFileSync(new URL('./n-v13-index.ts',import.meta.url),'utf8');

test('streaming collections and themed channels split based on provider source',()=>{
 const samples=[
  ['RAW','US| PRIME','FAST TV'],
  ['RAW','UK| PRIME ᴿᴬᵂ ⁶⁰ᶠᵖˢ','FAST TV'],
  ['RAW','US| TUBI ᴿᴬᵂ','FAST TV'],
  ['RAW','US| PLUTO TV','FAST TV'],
  ['STREAMING','Pluto TV','FAST TV'],
  ['ENTERTAINMENT','CINEMANIA TV SHOWS','24/7 Series'],
  ['STREAMING','Netflix',null],
  ['STREAMING','Prime Video',null],
  ['STREAMING','Disney+',null],
  ['STREAMING','Apple TV+',null],
  ['RAW','UK| NOW TV',null],
  ['RAW','US| HBO MAX NETWORK',null],
  ['RAW','UK| PRIME VIDEO SERIES',null],
  ['RAW','US| PARAMOUNT+ PPV',null],
  ['ENTERTAINMENT','US FAST TV',null],
  ['ENTERTAINMENT','UK TV',null],
  ['RAW','UK| GENERAL',null],
  ['RAW','24/7 SHOWS VIP',null]
 ];
 for(const [c,s,expected] of samples)assert.equal(group(c,s),expected,c+" "+s);
});
test('v13 preserves first 22 Xtream group IDs and all existing group mappings',()=>{
 const parse=(source)=>source.match(/const NUVIO_GROUPS=\[([\s\S]*?)\];/)?.[1]?.match(/"[^"]+"/g)?.map(n=>n.slice(1,-1));
 const prev=parse(v12),next=parse(v13);
 assert.equal(prev.length,22);
 assert.equal(next.length,23);
 assert.deepEqual(next.slice(0,22),prev);
 assert.equal(next[22],'FAST TV');
 assert.match(v13,/return String\(1800101\+\(n<0\?14:n\)\)/);
 assert.match(v13,/"Live Events":"99 /);
});
test('v13 modifies categorization without touching Xtream streams or EPG passthrough',()=>{
 assert.match(v13,/import \{ nuvioStreamingGroup \} from "\.\/qa-stream-groups\.mjs";/);
 assert.match(v13,/const gstream=nuvioStreamingGroup\(t,v\);/);
 assert.match(v13,/if\(gstream\)return gstream;/);
 assert.match(v13,/const visible=filtered;/);
 assert.match(v13,/stream_id:Number\(r\.external_id\)/);
 assert.match(v13,/epg_channel_id:effectiveLiveEpgId\(r\)/);
 assert.match(v13,/category_id:nuvioGroupId\(nuvioGroup\(r\)\)/);
 assert.match(v13,/const g247=nuvio247Group\(t,v\);/);
 assert.match(v13,/const sa=nuvioChannelPriority\(nuvioGroup\(a\),a\)/);
});
