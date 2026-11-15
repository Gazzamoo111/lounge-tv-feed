import test from 'node:test';
import assert from 'node:assert/strict';
import {qaAuVisibleRows} from './qa-au-duplicates.mjs';

const au=(name,epg,category='RAW',id=0)=>({display_name:name,epg_id:epg,category,provider_stream_id:id,group:'Australia'});
const visible=(rows)=>qaAuVisibleRows(rows,row=>row.group);
test('keep curated national secondary service; hide regional simulcasts with same known EPG',()=>{
  const list=[au('7flix','7Flix.au','Australia',752160),au('7FLIX BRISBANE','7Flix.au','RAW',752166),
    au('7FLIX CANBERRA','7Flix.au','RAW',752165),au('7FLIX PERTH','7Flix.au','RAW',752161)];
  const result=visible(list); assert.deepEqual(result.map(x=>x.provider_stream_id),[752160]);
  assert.equal(list.length,4,'inventory source array must not be mutated');
});
test('preserve regionally distinct main networks and no-EPG region feeds',()=>{
  const rows=[au('ABC','ABC.au','Australia',156899),au('ABC BRISBANE',null,'RAW',156898),
    au('CHANNEL 9 PERTH',null,'RAW',156865),au('10 SHAKE SYDNEY',null,'RAW',752176),
    au('AU: 9NOW 9GEM (NSW) ᴿᴬᵂ',null,'RAW',1921349)];
  assert.deepEqual(visible(rows),rows);
});
test('different EPG mappings are never collapsed',()=>{
  const rows=[au('SBS Food','SBSFood.au','Australia'),au('SBS FOOD PERTH','SBSFood.Perth.au'),
    au('10 Peach','10Peach.au','Australia'),au('10 PEACH BRISBANE',null),
    au('CHANNEL 10 PERTH','10Bold.au')];
  assert.deepEqual(visible(rows),rows);
});
test('national Racing.com stays visible when no curated primary exists',()=>{
  const rows=[au('RACING.COM MELBOURNE','RacingCom.au','RAW',1),
    au('RACING.COM NATIONAL','RacingCom.au','RAW',2),au('RACING.COM PERTH','RacingCom.au','RAW',3)];
  assert.deepEqual(visible(rows).map(x=>x.provider_stream_id),[2]);
  assert.deepEqual(visible(rows.filter(x=>x.provider_stream_id!==2)).map(x=>x.provider_stream_id),[1,3],
    'no national primary means do not suppress regionals');
});
test('all other categories, independent sports backups, and ordering survive unchanged',()=>{
  const rows=[au('FOX SPORTS 505','FoxSports5.au','Australia',646967),
    au('KAYO - FOX SPORTS 505','FoxSports5.au','RAW',1520174),
    {...au('7FLIX PERTH','7Flix.au','RAW',752161),group:'Sports Networks'},
    {...au('7FLIX PERTH','7Flix.au','RAW',752162),group:'Live Events'},
    {...au('7FLIX PERTH','7Flix.au','RAW',752163),group:'New Zealand'}];
  assert.deepEqual(visible(rows),rows);
});
test('duplicate names alone never trigger deletion',()=>{
  const rows=[au('7FLIX SYDNEY','7Flix.au','RAW',1),au('7FLIX PERTH','7Flix.au','RAW',2),
    au('RACING.COM PERTH','RacingCom.au','RAW',3)];
  assert.deepEqual(visible(rows),rows);
});
test('shared EPG approved families consolidate without touching stream/EPG fields',()=>{
  const rows=[au('10 Peach','10Peach.au','Australia',752184),au('10 PEACH ADELAIDE','10Peach.au','RAW',752191),
    au('ABC ME','ABCME.au','Australia',156882),au('ABC ME NATIONAL','ABCME.au','RAW',156902),
    au('SBS Viceland','SBSViceland.au','Australia',156874),au('SBS VICELAND NATIONAL','SBSViceland.au','RAW',156922)];
  const result=visible(rows);
  assert.deepEqual(result.map(x=>x.provider_stream_id),[752184,156882,156874]);
  assert.equal(result[0].epg_id,'10Peach.au');
});
