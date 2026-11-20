#!/usr/bin/env node
// Offline QA for a clean Xperience manifest. No credentials, network or Nuvio writes.
import { readFile } from "node:fs/promises";
const manifestPath = process.argv[2];
if (!manifestPath || manifestPath.startsWith("http")) {
  console.error("Usage: node scripts/customer-onboarding/validate-xperience.mjs <local-manifest.json>");
  process.exit(2);
}
const referencePath = new URL("../../qa/customer-onboarding/xperience-layout-reference.json", import.meta.url);
let reference, manifest;
try {
  reference = JSON.parse(await readFile(referencePath, "utf8"));
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  console.error("Could not read the neutral layout reference and supplied JSON manifest.");
  process.exit(2);
}
if (!Array.isArray(manifest.catalogs)) {
  console.error("Not a Stremio/Nuvio addon manifest: catalogs array missing.");
  process.exit(2);
}
const available = new Set(manifest.catalogs.map(c => String(c.type) + ":" + String(c.id)));
const folders = reference.collections.flatMap(c =>
  c.folders.map(f => ({collection: c.title, title: f.title, catalogs: f.catalogs}))
);
const missing = [];
let matched = 0, emptyFolders = 0, sources = 0;
for (const folder of folders) {
  let found = 0;
  for (const source of folder.catalogs) {
    sources++;
    if (available.has(String(source.type) + ":" + String(source.catalogId))) {
      matched++;
      found++;
    } else missing.push(folder.collection + " / " + folder.title + " : " + source.type + " / " + source.catalogId);
  }
  if (!found) emptyFolders++;
}
console.log(JSON.stringify({
  collections: reference.collections.length, folders: folders.length, catalogReferences: sources,
  matched, missing: missing.length, emptyFolders, exampleMissing: missing.slice(0, 15),
  result: missing.length === 0 && emptyFolders === 0 ? "PASS" : "FAIL",
  note: "Catalog ID coverage only. Populated content, row order, badge settings and Fire TV must be tested in Nuvio."
}, null, 2));
if (missing.length || emptyFolders) process.exitCode = 1;
