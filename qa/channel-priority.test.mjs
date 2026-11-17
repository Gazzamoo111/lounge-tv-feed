import test from 'node:test';
import assert from 'node:assert/strict';
import { nuvioChannelPriority as score } from './channel-priority.mjs';
const rank=(group,names)=>names.map(name=>({display_name:name,category:'New Zealand'})).sort((a,b)=>score(group,a)-score(group,b)).map(r=>r.display_name);
test('NZ main channels then nine Sky networks then others',()=>{
 const input=['Te Reo','Sky Sport 9','TVNZ DUKE HD','TVNZ 2','Sky Sport 1','Three','Whakaata Māori','TVNZ 1','Bravo'];
 assert.deepEqual(rank('New Zealand',input),['TVNZ 1','TVNZ 2','Three','Whakaata Māori','Te Reo','Sky Sport 1','Sky Sport 9','TVNZ DUKE HD','Bravo']);
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

const previewRank=(group,rows)=>[...rows].sort((a,b)=>
  score(group,a,Boolean(a.hasGuide))-score(group,b,Boolean(b.hasGuide))
  ||a.display_name.localeCompare(b.display_name,undefined,{numeric:true,sensitivity:'base'}))
  .map(r=>r.display_name);
test('v27 streaming brands prioritised, preserving source IDs and no synthetic EPG',()=>{
 const rows=[
  {display_name:'SKYMIX SERIES 1',subcategory:'SkyMix Series'},
  {display_name:'HULU ORIGINALS 1',subcategory:'Hulu'},
  {display_name:'APPLE TV+ SERIES 1',subcategory:'Apple TV+'},
  {display_name:'NETFLIX SHOW',subcategory:'Netflix',external_id:9001,epg_id:''},
  {display_name:'DISNEY+ PREMIERE 1',subcategory:'Disney+'},
  {display_name:'PRIME VIDEO SHOW',subcategory:'Prime Video'}
 ];
 const unchanged=JSON.stringify(rows);
 assert.deepEqual(previewRank('Entertainment & Streaming',rows),[
  'NETFLIX SHOW','PRIME VIDEO SHOW','DISNEY+ PREMIERE 1',
  'APPLE TV+ SERIES 1','HULU ORIGINALS 1','SKYMIX SERIES 1'
 ]);
 assert.equal(JSON.stringify(rows),unchanged);
});
test('v27 FAST prioritises scheduled Pluto then remaining Pluto, Tubi, Prime',()=>{
 const rows=[
  {display_name:'PRIME SHOW',subcategory:'US| PRIME'},
  {display_name:'TUBI SHOW',subcategory:'US| TUBI'},
  {display_name:'PLUTO UNSCHEDULED',subcategory:'Pluto TV'},
  {display_name:'JOHNNY CARSON TV',subcategory:'US| PLUTO TV',hasGuide:true}
 ];
 assert.deepEqual(previewRank('FAST TV',rows),[
  'JOHNNY CARSON TV','PLUTO UNSCHEDULED','TUBI SHOW','PRIME SHOW'
 ]);
});
test('v27 cinema prioritises known scheduled channels and moves Sky Store after them',()=>{
 const rows=[
  {display_name:'SKY STORE PREMIERE 1'},
  {display_name:'SKY STORE PREMIERE 10'},
  {display_name:'HBO',hasGuide:true},
  {display_name:'GREAT! MOVIES',hasGuide:true},
  {display_name:'FILM 4',hasGuide:true},
  {display_name:'SKY CINEMA PREMIER',hasGuide:true},
  {display_name:'SKY STORE INFO'},
  {display_name:'UNKNOWN MOVIE CHANNEL'}
 ];
 assert.deepEqual(previewRank('Movie Channels',rows),[
  'SKY CINEMA PREMIER','FILM 4','GREAT! MOVIES','HBO',
  'UNKNOWN MOVIE CHANNEL','SKY STORE PREMIERE 1',
  'SKY STORE PREMIERE 10','SKY STORE INFO'
 ]);
});
test('v27 Kids recognisable broadcasters lead ChuChu 1-10 and 24/7 Kids 1-12 in numeric sequence',()=>{
 const names=['24/7 KIDS 12','CHU CHU TV 10','24/7 KIDS 1','CHU CHU TV 2',
  'DISNEY JR','NICK JR','CARTOON NETWORK WEST','CHU CHU TV 1',
  '24/7 KIDS 10','CHU CHU TV 9','24/7 KIDS 2'];
 const ordered=previewRank('Kids & Family',names.map(display_name=>({display_name})));
 assert.deepEqual(ordered,['DISNEY JR','NICK JR','CARTOON NETWORK WEST',
   'CHU CHU TV 1','CHU CHU TV 2','CHU CHU TV 9','CHU CHU TV 10',
   '24/7 KIDS 1','24/7 KIDS 2','24/7 KIDS 10','24/7 KIDS 12']);
});
test('v27 guide preference applies only to new four groups, not NZ/AU/Sports',()=>{
 const row={display_name:'MYSTERY',category:'RAW',epg_id:'abc',external_id:12345};
 for(const group of ['New Zealand','Australia','Sports Networks','UK TV','US TV'])
  assert.equal(score(group,row,true),score(group,row,false));
 assert.ok(score('Movie Channels',row,true)<score('Movie Channels',row,false));
});

test('v29 AU source comparison: FOX HD and Kayo ordered as exact pairs, retaining source identity',()=>{
  const rows=[
    {display_name:'KAYO - FOX SPORTS 503',category:'RAW',provider_stream_id:1520175},
    {display_name:'FOX SPORTS 501',category:'Australia',provider_stream_id:646971},
    {display_name:'KAYO - FOX SPORTS 501 CRICKET',category:'RAW',provider_stream_id:1520176},
    {display_name:'FOX SPORTS 503',category:'Australia',provider_stream_id:646969},
    {display_name:'KAYO - FOX SPORTS 502 LEAUGE',category:'RAW',provider_stream_id:1520171},
    {display_name:'FOX SPORTS 502',category:'Australia',provider_stream_id:646970},
    {display_name:'FOX CRICKET',category:'Australia',provider_stream_id:646948},
    {display_name:'KAYO - ESPN 2',category:'RAW',provider_stream_id:1520167},
    {display_name:'ESPN2 Australia',category:'Australia',provider_stream_id:646973},
    {display_name:'ESPN Australia',category:'Australia',provider_stream_id:646974},
    {display_name:'KAYO - ESPN 1',category:'RAW',provider_stream_id:1520168}
  ];
  const input=JSON.stringify(rows);
  const ordered=[...rows].sort((a,b)=>score('Australia',a)-score('Australia',b));
  assert.deepEqual(ordered.map(r=>r.provider_stream_id),[
    646971,1520176,646970,1520171,646969,1520175,
    646948,646974,1520168,646973,1520167
  ]);
  assert.equal(JSON.stringify(rows),input,'QA source pairing must not modify IDs or streams');
});
