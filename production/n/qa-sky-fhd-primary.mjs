// QA-only Sky Sport NZ feed trial.
// Redirect the nine curated Sky Sport channel IDs to a separately provisioned
// provider source. No DB mutation, EPG change, category change, or video proxy.
const FHD_BY_CHANNEL=new Map([
  [1,[636918,2024778]],
  [2,[636919,2024777]],
  [3,[636920,2024776]],
  [4,[636921,2024775]],
  [5,[636922,2024774]],
  [6,[636923,2024773]],
  [7,[636924,2024772]],
  [8,[636925,2024771]],
  [9,[636926,2024770]],
]);

export function qaSkySwapPrimary(row) {
  if(!row || row.provider_name!=="BEST")return row;
  const match=/^SKY SPORT ([1-9])$/i.exec(String(row.display_name||"").trim());
  if(!match)return row;
  const [original,alternate]=FHD_BY_CHANNEL.get(Number(match[1]))||[];
  if(Number(row.provider_stream_id)!==original)return row;
  return {...row,provider_stream_id:alternate};
}
