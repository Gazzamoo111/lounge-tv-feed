import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nuvioChannelPriority } from './channel-priority.mjs';

const handler = readFileSync(new URL('./n-v10-index.ts', import.meta.url), 'utf8');
const groups = ['New Zealand', 'Australia', 'Live Events'];
const rows = [
  { display_name: 'Te Reo', category: 'New Zealand', group: groups[0] },
  { display_name: 'Sky Sport 9', category: 'New Zealand', group: groups[0] },
  { display_name: 'TVNZ 2', category: 'New Zealand', group: groups[0] },
  { display_name: 'TVNZ 1', category: 'New Zealand', group: groups[0] },
  { display_name: 'Three', category: 'New Zealand', group: groups[0] },
  { display_name: 'Whakaata Māori', category: 'New Zealand', group: groups[0] },
  { display_name: 'Sky Sport 1', category: 'New Zealand', group: groups[0] },
  { display_name: 'Duke', category: 'New Zealand', group: groups[0] },
  { display_name: 'Bravo', category: 'New Zealand', group: groups[0] },
  { display_name: 'HGTV', category: 'New Zealand', group: groups[0] },
  { display_name: 'ABC', category: 'Australia', group: groups[1] },
  { display_name: 'Seven', category: 'Australia', group: groups[1] },
  { display_name: 'PPV Event Z', category: 'PPV', group: groups[2] },
];
function ranked(items) {
 return [...items].sort((a,b) => {
   const ga = groups.indexOf(a.group), gb = groups.indexOf(b.group);
   if (ga !== gb) return ga - gb;
   const sa = nuvioChannelPriority(a.group,a), sb = nuvioChannelPriority(b.group,b);
   return sa !== sb ? sa - sb : a.display_name.localeCompare(b.display_name,undefined,{numeric:true,sensitivity:'base'});
 });
}
test('QA Xtream response preserves upstream rank when PPV exists', () => {
 assert.match(handler,/const visible=filtered;/);
 assert.doesNotMatch(handler,/filtered\.some\(\(r:any\)=>String\(r\.category\)==="PPV"\)/);
 const response = ranked(rows).map((row,i)=>({ num:i+1,name:row.display_name,group:row.group }));
 assert.deepEqual(response.slice(0,4).map(r=>[r.name,r.num]),[['TVNZ 1',1],['TVNZ 2',2],['Three',3],['Whakaata Māori',4]]);
 assert.equal(response.at(-1).name,'PPV Event Z');
 assert.deepEqual(response.filter(r=>r.group==='Australia').map(r=>r.name),['ABC','Seven']);
});
test('category filtered Xtream response starts numbering from 1', () => {
 const nz = ranked(rows).filter(r=>r.group==='New Zealand').map((r,i)=>({name:r.display_name,num:i+1}));
 assert.equal(nz[0].num,1); assert.equal(nz.at(-1).name,'Te Reo');
});
