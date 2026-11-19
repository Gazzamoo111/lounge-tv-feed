/** QA-only SKY SPORT NZ recovery based on live 19 Nov byte probes.
 * FHD sources returned 0 video bytes. Verified backup sources emitted
 * transport-stream packets for 1,2,3,9; 4-8 remain unverified and unchanged.
 * Do not use as a substitute for actual viewing tests.
 */
const VERIFIED_BACKING=new Map([
 [1,636918], // Original HD returned 4096 TS bytes.
 [2,1424317], // Provider "SKY SPORTS NZ 2" returned 2746 TS bytes.
 [3,1424316], // Provider "SKY SPORTS NZ 3" returned 2746 TS bytes.
 [9,636926], // Original HD returned transport-stream bytes.
]);
export function regionalSkyPreferredSource(row){
 if(!row||row.provider_name!=="BEST")return row;
 const match=/^SKY SPORT ([1-9])$/i.exec(String(row.display_name||"").trim());
 if(!match)return row;
 const source=VERIFIED_BACKING.get(Number(match[1]));
 if(!source||Number(row.provider_stream_id)===source)return row;
 return {...row,provider_stream_id:source};
}
