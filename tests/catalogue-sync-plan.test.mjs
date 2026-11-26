import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue, planCatalogue } from '../scripts/catalogue-sync-plan.mjs';

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
  assert.deepEqual(p.pending.map(x=>x.reason),["possible_duplicate_or_excluded","unmapped_group"]);
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

test('age out only events after three consecutive complete hourly observations', () => {
  const f = fixture();
  f.live = f.live.concat(Array.from({ length: 7 }, (_, i) => ({
    stream_id: 210 + i, category_id: '25', name: 'Event ' + i,
  })));
  f.providerStreams.push(...f.live.slice(3).map(row => ({ ...row, category_id: '20' })));
  const first = planCatalogue({ ...f, slot: 10 });
  assert.deepEqual(first.missing.map(row => row.stream_id), [210]);
  assert.deepEqual(first.removals, []);
  const second = planCatalogue({ ...f, slot: 11, previous: first.state });
  assert.deepEqual(planCatalogue({ ...f, slot: 11, previous: second.state }).removals, []);
  assert.deepEqual(planCatalogue({ ...f, slot: 13, previous: second.state }).removals, []);
  const third = planCatalogue({ ...f, slot: 12, previous: second.state });
  assert.deepEqual(third.removals, [210]);
  assert.deepEqual(third.state.retired, ['210']);
  f.live.find(row => row.stream_id === 210).epg_channel_id = 'approved-guide-id';
  assert.deepEqual(planCatalogue({ ...f, slot: 12, previous: second.state }).removals, []);
});

test('withhold previously excluded streams and quality aliases across categories', () => {
  const f = fixture();
  f.providerStreams.push({ stream_id: 103, category_id: '10', name: 'Channel One FHD' });
  const p = planCatalogue({ ...f, mode: 'daily', excludedIds: [101, 201] });
  assert.deepEqual(p.additions, []);
  assert.equal(p.pending.find(row => row.stream_id === 103).reason, 'possible_duplicate_or_excluded');
});

test('hold publication on mismatched category identity or a partial event group', () => {
  const f = fixture();
  f.mappings.groups['20'] = { target: '25', targetName: 'Events & PPV', sourceName: 'Unapproved' };
  assert.throws(() => planCatalogue(f), /identity changed/);
  f.mappings.groups['20'].sourceName = 'PPV';
  f.mappings.minimumGroupCounts = { '20': 3 };
  assert.throws(() => planCatalogue(f), /inventory floor/);
});

test('build matching Xtream, per-category and M3U assets and preserve existing routing', () => {
  const f = fixture();
  f.live[0].epg_channel_id = 'guide.one';
  f.live.forEach((row, i) => { row.num = i + 1; });
  const block = (sid, title, format, extra = '') =>
    `#EXTINF:-1 tvg-name="${title}" tvg-id="guide.one",${title}\n${extra}{{BASE}}/live/{{USER}}/{{PASS}}/${sid}.${format}\n`;
  const nz = block(100, 'Channel One', 'mpd', '#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\n');
  const assets = {
    'catalog/live_categories.json': JSON.stringify(f.categories),
    'catalog/live_all.json': JSON.stringify(f.live),
    'catalog/by-category/1.json': JSON.stringify(f.live.slice(0, 1)),
    'catalog/by-category/25.json': JSON.stringify(f.live.slice(1)),
    'catalog/template.m3u': '#EXTM3U x-tvg-url="{{EPG_URL}}"\n' + nz + block(200, 'Event A', 'ts'),
  };
  const result = buildCatalogue({ ...f, assets, mode: 'daily' });
  const rows = JSON.parse(result.assets['catalog/live_all.json']);
  assert.deepEqual(rows.map(row => row.stream_id), [100, 101, 200, 201]);
  assert.deepEqual(rows[0], f.live[0]);
  assert.equal(rows[2].name, 'Event B');
  assert.deepEqual(JSON.parse(result.assets['catalog/by-category/25.json']), rows.slice(2));
  assert.equal(result.assets['catalog/live_categories.json'], assets['catalog/live_categories.json']);
  assert.ok(result.assets['catalog/template.m3u'].includes(nz));
  assert.match(result.assets['catalog/template.m3u'], /tvg-name="Event B".*,Event B/);
  assert.ok(result.assets['catalog/template.m3u'].endsWith('{{BASE}}/live/{{USER}}/{{PASS}}/201.ts\n'));
  assert.throws(() => buildCatalogue({ ...f, assets: { ...assets, 'catalog/by-category/25.json': '[]' } }), /category assets differ/);
});
