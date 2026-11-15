import test from 'node:test';
import assert from 'node:assert/strict';
import { qaEpgAlias } from './qa-epg-alias.mjs';
test('restore existing AU guide for nationally equivalent channels',()=>{
 assert.equal(qaEpgAlias('Australia','AU: 9NOW 9GEM (NSW) ᴿᴬᵂ'),'live:au-9gem');
 assert.equal(qaEpgAlias('Australia','9NOW 9GO! (NSW) ᴿᴬᵂ'),'live:au-9go');
 assert.equal(qaEpgAlias('Australia','9NOW 9LIFE (NSW) ᴿᴬᵂ'),'live:au-9life');
 assert.equal(qaEpgAlias('Australia','9NOW 9RUSH (NSW) ᴿᴬᵂ'),'live:au-9rush');
 assert.equal(qaEpgAlias('Australia','ABC NEWS SYDNEY'),'live:abc-news-sydney');
});
test('do not attach NSW schedule to a different regional stream',()=>{
 assert.equal(qaEpgAlias('Australia','AU: 9NOW 9GEM (WA) ᴿᴬᵂ'),null);
 assert.equal(qaEpgAlias('Australia','AU: 9NOW 9GEM (VIC) ᴿᴬᵂ'),null);
 assert.equal(qaEpgAlias('Australia','ABC KIDS PERTH'),null);
});
test('do not map other countries or sports events to AU guide',()=>{
 assert.equal(qaEpgAlias('US TV','ABC NEWS SYDNEY'),null);
 assert.equal(qaEpgAlias('Live Events','9NOW 9GEM (NSW)'),null);
});
