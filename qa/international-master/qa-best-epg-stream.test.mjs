import test from "node:test";
import assert from "node:assert/strict";
import {qaGuideIdentity,qaGuideEpoch,qaGuideScanner,qaGuideScanChunk,
        qaFilteredBestXmltv} from "./qa-best-epg-stream.mjs";

const now=Date.UTC(2026,10,19,5);
const channel=(id,name)=>'<channel id="'+id+'"><display-name>'+name+'</display-name></channel>';
const epg=(id,start,stop,title="Real programme")=>
  '<programme channel="'+id+'" start="'+start+'" stop="'+stop+'"><title>'+title+'</title></programme>';

test("normalize quality/region labels, but do not match wrong channels",()=>{
  assert.equal(qaGuideIdentity("FR| France 24 FHD"),qaGuideIdentity("France 24"));
  assert.notEqual(qaGuideIdentity("France 24"),qaGuideIdentity("01TV"));
  assert.notEqual(qaGuideIdentity("Sky Sport 1"),qaGuideIdentity("Sky Sport 2"));
  assert.equal(qaGuideEpoch("20261119180000 +1300"),now);
});

test("only authentic, current, correct-ID channels and programme blocks pass",async()=>{
 const items=[
  {display_name:"FR| France 24 HD",epg_id:"france24.fr"},
  {display_name:"AR| France 24 FHD",epg_id:"01tv.fr"},
  {display_name:"DE| ZDF HD",epg_id:"zdf.de"},
  {display_name:"UK| BBC One HD",epg_id:"bbc.uk",qaEpgRejected:true}
 ];
 const xml='<?xml version="1.0"?><tv>'+
  channel("france24.fr","France 24")+channel("01tv.fr","01TV")+
  channel("zdf.de","ZDF")+channel("bbc.uk","BBC One")+
  epg("france24.fr","20261119180000 +1300","20261119190000 +1300")+
  epg("01tv.fr","20261119180000 +1300","20261119190000 +1300")+
  epg("zdf.de","20261118180000 +1300","20261118190000 +1300")+
  epg("bbc.uk","20261119180000 +1300","20261119190000 +1300")+
  '</tv>';
 const input=(async function*(){ const bytes=new TextEncoder().encode(xml); for(let i=0;i<bytes.length;i+=3)yield bytes.slice(i,i+3);})();
 const output=[];
 for await(const part of qaFilteredBestXmltv(input,items,r=>r.epg_id,[],now))output.push(part);
 const joined=output.join("");
 assert.ok(joined.includes('id="france24.fr"'));
 assert.ok(joined.includes('channel="france24.fr"'));
 assert.ok(joined.includes('id="zdf.de"'));
 assert.ok(!joined.includes('channel="zdf.de"'));
 assert.ok(!joined.includes('id="01tv.fr"'));
 assert.ok(!joined.includes('id="bbc.uk"'));
});

test("shared EPG IDs take precedence to avoid duplicate programme rows",()=>{
 const state=qaGuideScanner([{display_name:"France 24",epg_id:"france24.fr"}],r=>r.epg_id,["france24.fr"],now);
 const xml=channel("france24.fr","France 24")+epg("france24.fr","20261119180000 +1300","20261119190000 +1300");
 assert.deepEqual(qaGuideScanChunk(state,xml),[]);
});

test("large incomplete XMLTV records abort without faking listings",()=>{
 const state=qaGuideScanner([{display_name:"ZDF",epg_id:"zdf.de"}],r=>r.epg_id,[],now);
 assert.throws(()=>qaGuideScanChunk(state,'<programme channel="zdf.de">'+ "a".repeat(1024*1024+1)),/oversize/);
});
