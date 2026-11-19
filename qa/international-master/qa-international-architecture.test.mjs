import test from "node:test";
import assert from "node:assert/strict";
import {
 masterVisibleOrder,masterSeaGroup,masterSeaGroups,
 masterRegionGroup,masterCategoryLabels
} from "./qa-international-architecture.mjs";

test("flat order has no duplicate groups and ends with event overflow",()=>{
 assert.equal(new Set(masterVisibleOrder).size,masterVisibleOrder.length);
 assert.deepEqual(masterVisibleOrder.slice(-2),["Live Events","PPV Source Overflow"]);
 assert.equal(masterVisibleOrder[0],"New Zealand");
 assert.equal(masterVisibleOrder[1],"Australia");
 assert.equal(masterVisibleOrder[2],"UK TV");
 assert.equal(masterVisibleOrder[3],"US TV");
 assert.equal(Object.keys(masterCategoryLabels).length,masterVisibleOrder.length);
 for(const title of masterVisibleOrder)
  assert.ok(masterCategoryLabels[title]?.length>1,title);
});

test("real BEST country prefixes never confuse Arabic, Argentina or Ireland with Iran",()=>{
 const fixtures={
  "AR| ALGERIA":"Arabic TV",
  "IR| IRELAND":"Ireland",
  "IR| IRAN":"Iran",
  "IR| SETANTA PPV":null,
  "CH| SWITZERLAND":"Switzerland",
  "CH| CHINA / HONGKONG":"China",
  "SK| SOUTH KOREA":"South Korea",
  "CG| MONTENEGRO":"Montenegro",
  "BH| BOSNIA":"Bosnia",
  "SL| SLOVENIA":"Slovenia",
  "IS| ISRAEL HD":"Israel",
  "ASIA | INDIA MOVIES":"India",
  "ASIA | YUPP TV EXCLUSIVE":"Asia (Other)",
  "LAT| MEXICO":"Mexico",
  "LAT| ARGENTINA":"Argentina",
  "LAT| CHILE":"Chile",
  "LAT| GENERAL":"Latin America",
  "AFR| ETHOPIA":"Africa",
  "BR| CULTURA":"Brazil",
  "DE| GERMANY HEVC":"Germany",
  "UKR| UKRAINE":"Ukraine"
 };
 for(const [provider,expected] of Object.entries(fixtures))
  assert.equal(masterRegionGroup(provider),expected,provider);
});

test("SEA labels are mapped once, not left as separate appended banks",()=>{
 assert.equal(masterSeaGroups.size,17);
 assert.equal(masterSeaGroup("India Streaming"),"India Streaming");
 assert.equal(masterSeaGroup("Singapore Sports"),"Asia Sports");
 assert.equal(masterSeaGroup("Malaysia Sports"),"Asia Sports");
 assert.equal(masterSeaGroup("Football"),"Live Events");
 assert.equal(masterSeaGroup("Live Sports Events"),"Live Events");
 assert.equal(masterSeaGroup("Not A Real Group"),null);
});
