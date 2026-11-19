/** QA-only Sky Sport sources with initial transport-stream byte evidence from 19 Nov 2026.
 * Sky Sport 4-8 have no confirmed working source, so retain existing mapping.
 * These byte probes DO NOT establish full-length playback, programme identity or account entitlement.
 */
const VALIDATED=new Map([
 [1,636918],[2,1424317],[3,1424316],[9,636926]
]);
export function regionalSkyPreferredSource(row){
 if(!row||row.provider_name!=="BEST")return row;
 const match=/^SKY SPORT ([1-9])$/i.exec(String(row.display_name||"").trim());
 if(!match)return row;
 const id=VALIDATED.get(Number(match[1]));
 if(!id||Number(row.provider_stream_id)===id)return row;
 return {...row,provider_stream_id:id};
}
