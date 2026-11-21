import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {bestRequestedStreamFormat as standard} from "../production/n/qa-live-format.mjs";
import {bestRequestedStreamFormat as plus} from "../production/plus/qa-live-format.mjs";

for (const [profile,choose] of [["standard",standard],["Plus",plus]]) {
  test(`${profile}: HLS only on explicit .m3u8 request`,()=>{
    assert.equal(choose("101.ts","ts"),"ts");
    assert.equal(choose("101.m3u8","ts"),"m3u8");
    assert.equal(choose("101.M3U8","ts"),"m3u8");
    assert.equal(choose("101","ts"),"ts");
    assert.equal(choose("101.ts","m3u8"),"m3u8");
    assert.equal(choose("101.m3u8.bak","ts"),"ts");
    assert.equal(choose("101.ts",""),"ts");
    assert.equal(choose("101.ts","ts;rm -rf /"),"tsrmrf");
  });
  test(`${profile}: BEST redirects use opt-in format for both main and raw backup`,()=>{
    const source=readFileSync(new URL(`../production/${profile==="Plus"?"plus":"n"}/index.ts`, import.meta.url),"utf8");
    assert.match(source,/import \{ bestRequestedStreamFormat \} from "\.\/qa-live-format\.mjs";/);
    assert.match(source,/rawId\+"\."\+bestRequestedStreamFormat\(idPart\)/);
    assert.match(source,/const ext=bestRequestedStreamFormat\(idPart,mapped\.source_format\)/);
  });
}
