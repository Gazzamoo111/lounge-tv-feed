/**
 * QA-only visibility rule. Remove the looping NZ Sky Sports group and its
 * nine FHD-replaced curated primaries; preserve all nine working HD BACKUP
 * channels and every other NZ, UK, Sky, EPG, and event source.
 */
export function qaSkyNzLoopFilter(rows) {
  return rows.filter((row) => {
    const name=String(row?.display_name||"").trim();
    const category=String(row?.category||"").trim();
    const sourceGroup=String(row?.subcategory||"").trim();
    // All sources from BEST's explicitly named "NZ| SKY SPORTS NZ" category.
    if(category.toUpperCase()==="RAW" && sourceGroup.toUpperCase()==="NZ| SKY SPORTS NZ") return false;
    // The nine trial FHD primaries are looping too; do not remove HD BACKUP.
    if(category.toLowerCase()==="new zealand" && row?.provider_name==="BEST" &&
       /^SKY SPORT [1-9]$/i.test(name)) return false;
    return true;
  });
}
