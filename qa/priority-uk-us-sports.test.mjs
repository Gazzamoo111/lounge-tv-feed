import test from 'node:test';
import assert from 'node:assert/strict';
import { nuvioChannelPriority as score } from './channel-priority.mjs';

function rank(group, names) {
  return names.map((name,i)=>({ display_name:name, category:i%3?'Entertainment':'RAW', external_id:1000+i }))
    .sort((a,b)=>score(group,a)-score(group,b)||a.display_name.localeCompare(b.display_name,undefined,{numeric:true,sensitivity:'base'}));
}
test('UK main terrestrial networks lead Sky and remaining services',()=>{
  const order=rank('UK TV', ['BBC ONE LONDON','GOLD','CHANNEL 5','ITV 1','SKY ATLANTIC','BBC TWO','E4','BBC ONE','CHANNEL 4','5 STAR','ITV 1 +1']);
  assert.deepEqual(order.slice(0,5).map(x=>x.display_name),['BBC ONE','BBC TWO','ITV 1','CHANNEL 4','CHANNEL 5']);
  assert.ok(order.findIndex(x=>x.display_name==='BBC ONE LONDON')>order.findIndex(x=>x.display_name==='SKY ATLANTIC'));
  assert.ok(order.findIndex(x=>x.display_name==='ITV 1 +1')>order.findIndex(x=>x.display_name==='GOLD'));
});
test('US national services lead affiliates and west feeds',()=>{
  const order=rank('US TV',['TV| A3 NEW YORK 04 WNBC NBC ᴿᴬᵂ','HGTV WEST','BRAVO','PBS','FX','ABC','NBC','CBS','FOX','HGTV']);
  assert.deepEqual(order.slice(0,4).map(x=>x.display_name),['ABC','CBS','NBC','FOX']);
  assert.ok(order.findIndex(x=>x.display_name==='HGTV')<order.findIndex(x=>x.display_name==='HGTV WEST'));
  assert.ok(order.findIndex(x=>x.display_name==='HGTV WEST')<order.findIndex(x=>x.display_name.startsWith('TV| A3 NEW YORK')));
});
test('sports main networks before specialist and alternate feeds',()=>{
  const order=rank('Sports Networks',['NBC SPORTS BAY AREA','NFL REDZONE','ESPN 2','NHL NETWORK','NBA TV','SKY SPORT 9','SKY SPORT 1','TNT SPORTS 1','BEIN SPORTS 1','SKY SPORTS MAIN EVENT','ESPN','CBS SPORTS NETWORK','TENNIS CHANNEL PLUS 9','FOX SPORTS 1']);
  assert.deepEqual(order.slice(0,3).map(x=>x.display_name),['SKY SPORTS MAIN EVENT','SKY SPORT 1','SKY SPORT 9']);
  assert.ok(order.findIndex(x=>x.display_name==='NFL REDZONE')<order.findIndex(x=>x.display_name==='TNT SPORTS 1'));
  assert.ok(order.findIndex(x=>x.display_name==='NBA TV')<order.findIndex(x=>x.display_name==='FOX SPORTS 1'));
});
test('ranking never mutates identities, category, stream or EPG metadata',()=>{
  const row={display_name:'ABC',category:'RAW',subcategory:'US| TV',external_id:12031,epg_id:'abc.us',logo_url:'https://example.invalid/a'};
  const before=JSON.stringify(row);
  assert.equal(score('US TV',row),0.25);
  assert.equal(JSON.stringify(row),before);
});
test('NZ / AU verified priorities remain unchanged',()=>{
  assert.deepEqual(rank('New Zealand',['Sky Sport 9','TVNZ 2','Three','TVNZ 1','Whakaata Māori']).map(x=>x.display_name),['TVNZ 1','TVNZ 2','Three','Whakaata Māori','Sky Sport 9']);
  assert.deepEqual(rank('Australia',['Fox Sports 501','Channel 9','ABC','Seven','Ten']).map(x=>x.display_name),['ABC','Seven','Channel 9','Ten','Fox Sports 501']);
});
