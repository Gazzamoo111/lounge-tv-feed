// QA-only transport bypass for Australian BEST Live TV in the unified M3U.
//
// The user observed these provider feeds working directly in Nuvio. The
// previous playlist sent Nuvio to an HTTPS gateway that 302-redirected to an
// HTTP provider URL. Android Media3 blocks cross-protocol redirects by default.
// This test removes that redirect ONLY for Australia, without changing source
// IDs, category/EPG metadata, or any NZ route.
//
// WARNING: raw provider links contain credentials. This helper is suitable
// ONLY for the internal QA/demo M3U. Customer bearer-token playlists must
// continue using the authenticated gateway until designed and verified.
export function qaAuBestDirectUrl(row, group, bestBase, username, password) {
  if(group!=='Australia'||String(row?.provider_name||'')!=='BEST')return null;
  const id=Number(row?.provider_stream_id);
  if(!Number.isSafeInteger(id)||id<=0)return null;
  if(!username||!password)return null;
  const ext=String(row?.source_format||'ts').trim().toLowerCase();
  if(ext!=='ts'&&ext!=='m3u8')return null;
  let url=String(bestBase||'');
  while(url.endsWith('/'))url=url.slice(0,-1);
  let parsed;
  try{parsed=new URL(url)}catch{return null}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password
      ||parsed.pathname!=='/'||parsed.search||parsed.hash)return null;
  return url+'/live/'+encodeURIComponent(username)+'/'+encodeURIComponent(password)+'/'+id+'.'+ext;
}
