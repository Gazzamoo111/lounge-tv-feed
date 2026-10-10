import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRelease} from '../validate.mjs';
import worker from '../api/worker.mjs';
const example={schema:1,revision:'20261010-test-1',generated_at:'2026-10-10T00:00:00Z',
live:{channels:[{id:'nz-1',name:'Sample Channel',artwork:'https://example.org/logo.png'}]},
vod:{titles:[{id:'film-1',name:'Sample Film',type:'movie'}]},
epg:{programmes:[{channel_id:'nz-1',start:'2026-10-10T12:00:00Z',end:'2026-10-10T13:00:00Z',title:'Sample'}]}};
test('valid metadata',()=>assert.equal(validateRelease(example).live_channels,1));
test('blocks credentials',()=>assert.throws(()=>validateRelease({...example,password:'secret'})));
test('blocks direct stream URL',()=>assert.throws(()=>validateRelease({...example,url:'http://test.example/live/user/pass/1.ts'})));
test('blocks duplicate channels',()=>assert.throws(()=>validateRelease({...example,live:{channels:[example.live.channels[0],example.live.channels[0]]}})));
test('inactive by default',async()=>{const r=await worker.fetch(new Request('https://example.org/v1/catalogue'),{});assert.equal(r.status,503);});
test('health is safe',async()=>{const r=await worker.fetch(new Request('https://example.org/v1/health'),{});assert.equal((await r.json()).enabled,false);});
