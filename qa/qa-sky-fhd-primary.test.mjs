import test from "node:test";
import assert from "node:assert/strict";
import {qaSkySwapPrimary} from "./qa-sky-fhd-primary.mjs";

const hd=[636918,636919,636920,636921,636922,636923,636924,636925,636926];
const fhd=[2024778,2024777,2024776,2024775,2024774,2024773,2024772,2024771,2024770];
test("all nine curated Sky Sport main IDs keep their stable logical/EPG identifiers but use distinct FHD sources",()=>{
  for(let i=1;i<=9;i++){
    const row={display_name:`SKY SPORT ${i}`,provider_name:"BEST",provider_stream_id:hd[i-1],
      external_id:4800+i,epg_id:`SkySport${i}.nz`,category:"New Zealand",
      logo_url:`https://example.invalid/logo${i}.png`,source_format:"ts"};
    const next=qaSkySwapPrimary(row);
    assert.equal(next.provider_stream_id,fhd[i-1]);
    assert.equal(row.provider_stream_id,hd[i-1],"do not mutate canonical row");
    for(const k of ["external_id","epg_id","category","logo_url","display_name","source_format"])
      assert.equal(next[k],row[k]);
  }
});
test("non-BEST sources, raw backups, mismatched IDs and non-Sky channels remain unchanged",()=>{
  const rows=[
    {display_name:"SKY SPORT 1",provider_name:"NZ-Freeview",provider_stream_id:636918},
    {display_name:"SKY SPORT 1",provider_name:"BEST",provider_stream_id:1424318},
    {display_name:"SKY SPORT 1",provider_name:"BEST",provider_stream_id:2024778},
    {display_name:"SKY SPORT 1 BACKUP",provider_name:"BEST",provider_stream_id:636918},
    {display_name:"SKY SPORT SELECT",provider_name:"BEST",provider_stream_id:636918},
    {display_name:"SKY SPORT 9",provider_name:"BEST",provider_stream_id:636918},
    {display_name:"FOX SPORTS 501",provider_name:"BEST",provider_stream_id:636918}
  ];
  for(const row of rows)assert.equal(qaSkySwapPrimary(row),row);
});
test("all nine replacement IDs unique and never the original",()=>{
  const output=hd.map((id,i)=>qaSkySwapPrimary({provider_name:"BEST",display_name:`SKY SPORT ${i+1}`,provider_stream_id:id}).provider_stream_id);
  assert.equal(new Set(output).size,9);
  for(let i=0;i<9;i++)assert.notEqual(output[i],hd[i]);
});
