import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qaAuWrongGuide} from './qa-au-integrity.mjs';

test('v29: Ten cannot inherit 10 Bold listings; other channels preserve guide',()=>{
  assert.equal(qaAuWrongGuide({category:'Australia',display_name:'Ten',epg_id:'10Bold.au'}),true);
  assert.equal(qaAuWrongGuide({category:'Australia',display_name:'10 BOLD',epg_id:'10Bold.au'}),false);
  assert.equal(qaAuWrongGuide({category:'Australia',display_name:'Ten',epg_id:'10Peach.au'}),false);
  assert.equal(qaAuWrongGuide({category:'US TV',display_name:'Ten',epg_id:'10Bold.au'}),false);
  assert.equal(qaAuWrongGuide({category:'Australia',display_name:'Channel 9',epg_id:'9Gem.au'}),false);
  assert.equal(qaAuWrongGuide(null),false);
});

test('v29: deny Ten wrong-guide list, short EPG and provider fallback in QA only',()=>{
  const c=readFileSync(new URL('./n-v22-index.ts',import.meta.url),'utf8');
  assert.match(c,/if\(qaAuWrongGuide\(row\)\)return "";/);
  assert.match(c,/if\(qaAuWrongGuide\(mapped\)\)return \[\];/);
  assert.match(c,/for\(const row of rows\)if\(qaAuWrongGuide\(row\)\)row\.epg_id="";/);
  assert.match(c,/nuvio:full:qa:v11-au-hls-transport/);
  assert.match(c,/\.\.\.qaTvnzXtreamDrmFields\(r\)/);
});
