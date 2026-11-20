import test from "node:test";
import assert from "node:assert/strict";
import {nuvioStreamingGroup} from "../production/n/qa-stream-groups.mjs";
import {PLUS_ORDER,PLUS_IDS,PLUS_LABELS,plusCategory} from "../production/plus/plus-categories.mjs";
test("movie banks isolate, standard movie channels remain",()=>{
 assert.equal(nuvioStreamingGroup("RAW","UK| SKY STORE","Sky Store Premiere 1"),"Movie Streams");
 assert.equal(nuvioStreamingGroup("RAW","US| CINEMANIA HOLLYWOOD","CM Hollywood Premiere 1"),"Movie Streams");
 assert.equal(nuvioStreamingGroup("RAW","UK| MOVIES","Cinemania Hollywood 4K"),"Movie Streams");
 assert.equal(nuvioStreamingGroup("RAW","UK| MOVIES","Sky Cinema Premiere"),null);
});
test("explicit event streams only",()=>{
 assert.equal(nuvioStreamingGroup("RAW","UK| SPORTS","Sky Sports Red Button 1"),"Live Events");
 assert.equal(nuvioStreamingGroup("RAW","US| SPORTS NETWORK","NFL PPV Event 2"),"Live Events");
 assert.equal(nuvioStreamingGroup("RAW","UK| SPORTS","Premier Sports 1"),null);
 assert.equal(nuvioStreamingGroup("RAW","US| SPORTS NETWORK","beIN Sports 1"),null);
});
test("original Plus IDs and labels",()=>{
 const legacy=["New Zealand","Australia","UK TV","UK Sports","US TV","US Sports","Sports Networks","Streaming Services","Movie Channels","Kids & Family","Documentaries & Lifestyle","FAST TV","Music","24/7 Movies","24/7 Series","24/7 Comedy & Reality","24/7 Drama & Crime","24/7 Streaming & OnePlay","24/7 Kids & Cartoons","Live Events"];
 assert.deepEqual(PLUS_ORDER.filter(g=>g!=="Movie Streams"),legacy);
 legacy.forEach((g,i)=>assert.equal(PLUS_IDS[g],String(2800101+i)));
 assert.equal(PLUS_IDS["Movie Streams"],"2800121");
 assert.equal(plusCategory({category:"RAW",subcategory:"UK| SKY STORE",display_name:"Sky Store Premiere 1"},"Movie Streams"),"Movie Streams");
 Object.values(PLUS_LABELS).forEach(v=>assert.doesNotMatch(v,/&/));
});