import test from 'node:test';
import assert from 'node:assert/strict';
import { nuvioChannelPriority as score } from './channel-priority.mjs';
const rank=(group,names)=>names.map(name=>({display_name:name,category:'New Zealand'})).sort((a,b)=>score(group,a)-score(group,b)).map(r=>r.display_name);
test('NZ main channels then nine Sky networks then others',()=>{
 const input=['Te Reo','Sky Sport 9','TVNZ DUKE HD','TVNZ 2','Sky Sport 1','Three','Whakaata Māori','TVNZ 1','Bravo'];
 assert.deepEqual(rank('New Zealand',input),['TVNZ 1','TVNZ 2','Three','Whakaata Māori','Sky Sport 1','Sky Sport 9','TVNZ DUKE HD','Bravo','Te Reo']);
});
test('Australia main network order and sport before unranked channels',()=>{
 const input=['FOX SPORTS 501','BEIN SPORTS 1','SBS','Channel 9','Seven','Ten','ABC','ABC Kids','ESPN Australia'];
 assert.deepEqual(rank('Australia',input),['ABC','Seven','Channel 9','Ten','SBS','ABC Kids','FOX SPORTS 501','ESPN Australia','BEIN SPORTS 1']);
});
test('AU region-specific raw variants stay lower than approved main networks',()=>{
 const main={display_name:'Channel 9',category:'Australia'};
 const regional={display_name:'AU: 9NOW CHANNEL 9 (WA) ᴿᴬᵂ',category:'RAW'};
 assert.ok(score('Australia',main)<score('Australia',regional));
});
test('preserves unrecognised channel order tier and does not rewrite metadata',()=>{
 const row={display_name:'SOME CHANNEL',category:'RAW',external_id:123,epg_id:'test'};
 const copy={...row};assert.equal(score('Australia',row),100.25);assert.deepEqual(row,copy);
});
