import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanXmltvStream } from './qa-epg.mjs';
const program = (ch,start,stop,title) => '<programme channel="'+ch+'" start="'+start+'" stop="'+stop+'"><title>'+title+'</title></programme>';
function chunks(s) {
  const bytes=new TextEncoder().encode(s);let pos=0,step=1;
  return new ReadableStream({pull(c){if(pos>=bytes.length){c.close();return;}
    const end=Math.min(bytes.length,pos+step);c.enqueue(bytes.slice(pos,end));pos=end;step=step%11+1;}});
}
const read=async(s,m=new Map())=>await new Response(cleanXmltvStream(chunks(s),m)).text();
test('canonical Sky replaces duplicate source programmes',async()=>{
  const p=program('SkySport4.nz','1','2','The Breakdown');
  const canonical='<channel id="SkySport4.nz"><display-name>Sky Sport 4</display-name></channel>'+p;
  const s='<tv><channel id="SkySport4.nz"></channel>'+p+p+'</tv>';
  const out=await read(s,new Map([['SkySport4.nz',canonical]]));
  assert.equal((out.match(/<programme /g)||[]).length,1);assert.match(out,/The Breakdown/);
});
test('exact duplicate in other channels removed, distinct slots retained',async()=>{
  const p=program('ABC.au','1','2','News'),q=program('ABC.au','2','3','News');
  const out=await read('<tv>'+p+p+q+'</tv>');
  assert.equal((out.match(/<programme /g)||[]).length,2);
});
test('no canonical Sky fallback retains upstream',async()=>{
  const p=program('SkySport4.nz','1','2','Rugby');
  const out=await read('<tv>'+p+'</tv>');
  assert.equal((out.match(/<programme /g)||[]).length,1);
});
test('missing channel declaration is injected with canonical programme',async()=>{
  const p=program('SkySport9.nz','1','2','Sport');
  const c='<channel id="SkySport9.nz"><display-name>Sky Sport 9</display-name></channel>'+p;
  const out=await read('<tv></tv>',new Map([['SkySport9.nz',c]]));
  assert.match(out,/<channel id="SkySport9.nz"/);assert.match(out,/<programme channel="SkySport9.nz"/);
});
test('truncated guide fails closed',async()=>{await assert.rejects(()=>read('<tv><programme>broken'),/Incomplete XMLTV root/);});