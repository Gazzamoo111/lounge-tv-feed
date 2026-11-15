import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qaEpgAlias} from './qa-epg-alias.mjs';

test('Australia: resolves verified Seven, Fox Sports 501/502/504/507 to correct distinct guide identities',()=>{
  assert.equal(qaEpgAlias('Australia','Seven'),'live:au-seven');
  assert.equal(qaEpgAlias('Australia','AU| CHANNEL 7 HD'),'live:au-seven');
  for(const n of [501,502,504,507]){
    assert.equal(qaEpgAlias('Australia',`FOX SPORTS ${n}`),`live:au-fox-sports-${n}`);
    assert.equal(qaEpgAlias('Australia',`AU| FOX SPORTS ${n} HD`),`live:au-fox-sports-${n}`);
  }
  assert.equal(qaEpgAlias('Australia','FOX SPORTS 503'),null);
  assert.equal(qaEpgAlias('Australia','FOX SPORTS 505'),null);
  assert.equal(qaEpgAlias('Australia','FOX SPORTS 506'),null);
});
test('New Zealand: all Sky Sport 1-9 main, FHD, HD and backup names map correctly',()=>{
  for(let n=1;n<=9;n++){
    for(const name of [`SKY SPORT ${n}`,`SKY SPORT ${n} FHD`,`SKY SPORT ${n} HD`,`SKY SPORT ${n} HD BACKUP`,`SKY SPORTS NZ ${n}`]){
      for(const group of ['New Zealand','Sports Networks'])assert.equal(qaEpgAlias(group,name),`SkySport${n}.nz`);
    }
  }
  assert.equal(qaEpgAlias('Sports Networks','SKY SPORTS NZ PL'),'SkySport8.nz');
});
test('Sports Networks: verified ESPNU, ESPN8 and Sky Tennis only',()=>{
  assert.equal(qaEpgAlias('Sports Networks','ESPNU'),'live:espnu');
  assert.equal(qaEpgAlias('Sports Networks','ESPN8: THE OCHO'),'live:espn8-the-ocho');
  assert.equal(qaEpgAlias('Sports Networks','SKY SPORTS TENNIS'),'live:sky-sports-tennis');
  assert.equal(qaEpgAlias('Sports Networks','UFC PPV 13'),null);
  assert.equal(qaEpgAlias('Live Events','ESPNU'),null);
});
test('existing Australia aliases preserved with regional restrictions',()=>{
  const m={'ABC NEWS SYDNEY':'live:abc-news-sydney','ABC KIDS NATIONAL':'ABC Kids','7FLIX':'7Flix.au','7MATE':'7Mate.au','7TWO':'7TWO.au','10 PEACH':'10Peach.au','9Gem':'live:au-9gem','9Go!':'live:au-9go','9Life':'live:au-9life','9Rush':'live:au-9rush'};
  for(const [name,id] of Object.entries(m))assert.equal(qaEpgAlias('Australia',name),id,name);
  assert.equal(qaEpgAlias('Australia','AU: 9NOW 9GEM (NEWCASTLE) ᴿᴬᵂ'),null);
  assert.equal(qaEpgAlias('Australia','9GEM (MELBOURNE)'),null);
  assert.equal(qaEpgAlias('Australia','7FLIX MELBOURNE'),null);
  assert.equal(qaEpgAlias('Australia','10 SHAKE'),null);
  assert.equal(qaEpgAlias('Australia','Ten'),null); // No verified Ten guide; 10Bold would be wrong.
});
test('No accidental international / unrelated guide crosslinks',()=>{
  assert.equal(qaEpgAlias('UK TV','SKY SPORT 1'),null);
  assert.equal(qaEpgAlias('US TV','FOX SPORTS 501'),null);
  assert.equal(qaEpgAlias('Sports Networks','SKY SPORTS MAIN EVENT'),null);
});
test('QA gateway uses validated aliases for playlist AND curated get_short_epg, never overwrites valid EPG mappings',()=>{
  const c=readFileSync(new URL('./n-v16-index.ts',import.meta.url),'utf8');
  assert.match(c,/import \{ qaEpgAlias \} from "\.\/qa-epg-alias\.mjs";/);
  assert.match(c,/if\(ids\.has\(String\(row\.epg_id\|\|""\)\)\)continue;/);
  assert.match(c,/if\(alias&&ids\.has\(alias\)\)row\.epg_id=alias;/);
  assert.match(c,/const aliasGuideId=qaEpgAlias\(nuvioGroup\(mapped\),String\(mapped\.display_name\|\|""\)\);/);
  assert.match(c,/const aliasGuide=await staticShortEpg\(aliasGuideId,limit,externalId\);/);
  assert.match(c,/if\(aliasGuide&&aliasGuide\.length\)return aliasGuide;/);
  assert.match(c,/const k="nuvio:full:qa:v6-epg"/);
});
