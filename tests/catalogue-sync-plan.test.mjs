import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCatalogue } from '../scripts/catalogue-sync-plan.mjs';

const fixture = () => ({
  categories: [{category_id:"1",category_name:"NZ TV"},{category_id:"25",category_name:"Events & PPV"}],
  live: [{stream_id:100,category_id:"1",name:"Channel One"},{stream_id:200,category_id:"25",name:"Event A"}],
  providerCategories: [{category_id:"10",category_name:"NZ"},{category_id:"20",category_name:"PPV"},{category_id:"30",category_name:"Unknown"}],
  providerStreams: [{stream_id:100,category_id:"10",name:"Channel One"},{stream_id:200,category_id:"20",name:"Event B"},{stream_id:201,category_id:"20",name:"New event"},{stream_id:101,category_id:"10",name:"Channel Two"},{stream_id:102,category_id:"10",name:"Channel One"},{stream_id:300,category_id:"30",name:"Unknown"}],
  mappings:{eventTarget:"25",groups:{"10":"1","20":"25"}}
});
test('hourly: only event additions and event name changes',()=>{
  const p=planCatalogue(fixture());
  assert.deepEqual(p.additions,[{stream_id:201,category_id:"25",name:"New event",epg_channel_id:""}]);
  assert.deepEqual(p.renames,[{stream_id:200,name:"Event B"}]);
  assert.equal(p.publish,false);
});
test('daily: known category additions, quarantine duplicate and unknown',()=>{
  const p=planCatalogue({...fixture(),mode:"daily"});
  assert.deepEqual(p.additions.map(x=>x.stream_id),[201,101]);
  assert.deepEqual(p.pending.map(x=>x.reason),["possible_duplicate","unmapped_group"]);
});
test('missing streams are reported, not removed; protect independent NZ IDs',()=>{
  const f=fixture();
  f.live.push(...Array.from({length:10},(_,i)=>({stream_id:400+i,category_id:"1",name:"Extra "+i})));
  f.providerStreams.push(...Array.from({length:9},(_,i)=>({stream_id:400+i,category_id:"10",name:"Extra "+i})));
  f.live.push({stream_id:900000001,category_id:"1",name:"Freeview"});
  f.protectedIds=[900000001];
  assert.deepEqual(planCatalogue(f).missing,[{stream_id:409,category_id:"1"}]);
});
test('reject empty and incomplete provider inventories',()=>{
  const f=fixture();
  assert.throws(()=>planCatalogue({...f,providerStreams:[]}));
  assert.throws(()=>planCatalogue({...f,providerStreams:[f.providerStreams[0]]}),/overlap/);
});
test('reject moved event category and unknown target',()=>{
  const f=fixture();
  assert.throws(()=>planCatalogue({...f,categories:[...f.categories].reverse()}),/last/);
  f.mappings.groups["30"]="99";
  assert.throws(()=>planCatalogue(f),/target/);
});
test('reject duplicate IDs, unexpected changes and malformed names',()=>{
  const f=fixture();
  assert.throws(()=>planCatalogue({...f,providerStreams:[...f.providerStreams,f.providerStreams[0]]}),/Duplicate/);
  assert.throws(()=>planCatalogue({...f,mode:"daily",maxAdditions:1}),/cap/);
  f.providerStreams[2].name="https://example.invalid/private";
  assert.throws(()=>planCatalogue(f),/display name/);
});
test('planner never mutates input and subsequent accepted changes are idempotent',()=>{
  const f=fixture(), before=JSON.stringify(f), p=planCatalogue(f);
  assert.equal(JSON.stringify(f),before);
  f.live=f.live.map(x=>x.stream_id===200?{...x,name:"Event B"}:x).concat(p.additions);
  const again=planCatalogue(f);
  assert.deepEqual(again.additions,[]);
  assert.deepEqual(again.renames,[]);
});
