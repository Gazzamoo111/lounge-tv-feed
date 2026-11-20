/**
 * QA customer visibility: keep the curated Sky Sport 1–9 FHD routes.
 * The old filter accidentally removed these and left unreliable HD RAW feeds
 * displayed as the main Sky channels. No underlying provider mapping is edited.
 */
const HD_BY_NUMBER=new Map(Array.from({length:9},(_,i)=>[i+1,636918+i]));
const FHD_BY_NUMBER=new Map(Array.from({length:9},(_,i)=>[i+1,2024778-i]));
export function qaSkyNzLoopFilter(rows) {
 return rows.filter(row=>{
  const name=String(row?.display_name||"").trim();
  const group=String(row?.subcategory||"").toUpperCase();
  const category=String(row?.category||"").toUpperCase();
  if(category==="RAW" && group==="NZ| SKY SPORTS NZ")return false;
  const matched=/^SKY SPORT ([1-9])(?: HD(?: BACKUP)?)?$/i.exec(name);
  if(!matched || row?.provider_name!=="BEST")return true;
  const number=Number(matched[1]);
  const id=Number(row.provider_stream_id);
  if(category==="RAW" && id===HD_BY_NUMBER.get(number))return false;
  // Keep curated Sky 1 and 9 where the checked HD source is selected.
  // Still hide old HD backup rows with raw external IDs.
  if(category==="NEW ZEALAND" && id===HD_BY_NUMBER.get(number))
    return Number(row.external_id)>0 && Number(row.external_id)<2000000000;
  // The curated display entry uses the FHD provider ID and retains its
  // stable Lounge external ID, guide, artwork and category.
  if(category==="NEW ZEALAND" && id===FHD_BY_NUMBER.get(number))return true;
  return true;
 });
}
