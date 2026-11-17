// QA only: allow the same Australian sport source to be tested with HLS.
// No primary/backup is changed. Public production, provider inventory and
// customer entitlements are untouched. Synthetic IDs fit signed int32.
export const QA_AU_HLS_BASE=2050000000;
const AU_TEST_SOURCES=new Set([
  646948, // Fox Cricket
  646965,646966,646967,646968,646969,646970,646971,646972, // Fox 507-501/News
  646973,646974, // ESPN 2/1
  1520167,1520168,1520169,1520170,1520171,
  1520172,1520173,1520174,1520175,1520176 // Kayo-labelled counterparts
]);
export function qaAuHlsVariants(rows,groupOf) {
  const seen=new Set();
  const extra=[];
  for (const row of rows) {
    const id=Number(row.provider_stream_id);
    if(groupOf(row)!=='Australia'||!AU_TEST_SOURCES.has(id)||seen.has(id)
       ||String(row.provider_name||'')!=='BEST')continue;
    seen.add(id);
    const external=QA_AU_HLS_BASE+id;
    if(!Number.isSafeInteger(external)||external>2147483647)
      throw Error('qa_au_hls_external_id_out_of_range');
    extra.push({...row,external_id:external,display_name:String(row.display_name)+' (HLS TEST)',
      source_format:'m3u8'});
  }
  return [...rows,...extra];
}
