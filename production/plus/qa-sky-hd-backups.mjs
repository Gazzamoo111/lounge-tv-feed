// QA-only: expose the previous NZ Sky Sport HD feeds for manual fallback
// after the primary feed switches to the alternate FHD source.
export function qaSkyOriginalHdBackups(rows, curated, inventory) {
  const known=new Set(rows.map(r=>Number(r.external_id)));
  const available=new Set(inventory.filter(r=>r.is_adult!==true).map(r=>Number(r.provider_item_id)));
  const additions=[];
  for(const row of curated){
    if(row.category!=="New Zealand" || row.provider_name!=="BEST")continue;
    const match=/^SKY SPORT ([1-9])$/i.exec(String(row.display_name||"").trim());
    if(!match)continue;
    const originalId=Number(row.provider_stream_id);
    const n=Number(match[1]);
    if(originalId!==636917+n || !available.has(originalId))continue;
    const externalId=2000000000+originalId;
    if(known.has(externalId))continue;
    const name=`SKY SPORT ${n} HD BACKUP`;
    additions.push({
      ...row,
      external_id:externalId,
      provider_stream_id:originalId,
      display_name:name,
      category:"New Zealand",
      subcategory:"Sports",
      epg_id:String(row.epg_id||`SkySport${n}.nz`),
      sort_order:900000+n
    });
    known.add(externalId);
  }
  return additions;
}
