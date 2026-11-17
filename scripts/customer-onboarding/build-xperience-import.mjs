#!/usr/bin/env node
// Creates a clean Xperience/Nuvio collections.json from the sanitised Lounge TV reference.
// Never import this into a personal profile; use a fresh neutral customer/master profile.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const newAddonId=process.argv[2]||"";
if(!/^app\.xperience\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(newAddonId)){
 console.error("Usage: node scripts/customer-onboarding/build-xperience-import.mjs app.xperience.<NEW_NEUTRAL_UUID> > /private/path/collections.json");
 process.exit(2);
}
const reference=JSON.parse(await readFile(new URL("../../qa/customer-onboarding/xperience-layout-reference.json",import.meta.url),"utf8"));
if(reference.status!=="REFERENCE_ONLY_NOT_DEPLOYED"||!Array.isArray(reference.collections)||reference.collections.length!==3){
 throw Error("Invalid or unreviewed reference");
}
const out=reference.collections.map(c=>({
 id:randomUUID(),title:c.title,pinToTop:c.pinToTop,focusGlowEnabled:c.focusGlowEnabled,
 viewMode:c.viewMode,showAllTab:c.showAllTab,backdropImageUrl:null,
 folders:c.folders.map(f=>({
  id:randomUUID(),title:f.title,hideTitle:f.hideTitle,
  coverImageUrl:f.coverImageUrl||null,coverEmoji:null,focusGifUrl:null,focusGifEnabled:false,
  heroBackdropUrl:f.heroBackdropUrl||null,heroVideoUrl:null,titleLogoUrl:f.titleLogoUrl||null,
  tileShape:f.tileShape,
  catalogSources:f.catalogs.map(s=>({addonId:newAddonId,type:s.type,catalogId:s.catalogId,genre:null})),
  sources:f.catalogs.map(s=>({provider:"addon",addonId:newAddonId,type:s.type,catalogId:s.catalogId,genre:"None"}))
 }))
}));
const folders=out.flatMap(x=>x.folders);
if(folders.length!==41||folders.reduce((sum,f)=>sum+f.catalogSources.length,0)!==223){
 throw Error("Reference has unexpected collection/catalogue counts");
}
process.stdout.write(JSON.stringify(out,null,2)+"\n");
