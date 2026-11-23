// NZ Freeview source mapping recovered from Lounge TV's existing production routes.
// No decryption, keys, upstream credentials, or DRM policy bypass. QA only.
const rows=new Map([
  [900000001,{name:'TVNZ 1',slug:'tvnz-1',format:'mpd',drm:'widevine',ch:'1'}],
  [900000002,{name:'TVNZ 2',slug:'tvnz-2',format:'mpd',drm:'widevine',ch:'2'}],
  [900000003,{name:'Three',slug:'three',format:'m3u8'}],
  [900000004,{name:'Whakaata Māori',slug:'maori-tv',format:'m3u8'}],
  [900000005,{name:'Te Reo',slug:'te-reo',format:'m3u8'}],
]);
export function nzSource(id){
  const row=rows.get(Number(id));
  return row?{...row,id:Number(id),url:'https://i.mjh.nz/.r/'+row.slug+'.'+row.format}:null;
}
const cors={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Methods':'POST,OPTIONS',
 'Access-Control-Allow-Headers':'Content-Type,Accept,User-Agent',
 'Cache-Control':'private, no-store',
 'X-Content-Type-Options':'nosniff',
};
const maxChallenge=128*1024;
const fail=(status,message)=>new Response(message,{status,headers:{...cors,'Content-Type':'text/plain; charset=utf-8'}});
function allowedTarget(value){
  try {
    const target=new URL(value);
    if(target.protocol!=='https:'||target.hostname!=='fvnz-capi-prod.switch.tv'||
      target.pathname!=='/playback-api/getlicense'||target.username||target.password)return null;
    if(!['auth','kid','ptoken','service','version'].every(k=>target.searchParams.has(k)))return null;
    return target;
  }catch{return null;}
}
/** Run only after the caller authenticates to the QA Xtream account. */
export async function nzLicenseRelay(request,url){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return fail(405,'POST required');
  const ch=url.searchParams.get('ch');
  if(ch!=='1'&&ch!=='2')return fail(404,'Unknown channel');
  const announced=Number(request.headers.get('Content-Length')||'0');
  if(!Number.isFinite(announced)||announced>maxChallenge)return fail(413,'Challenge too large');
  let challenge;
  try{challenge=await request.arrayBuffer();}catch{return fail(400,'Invalid challenge');}
  if(!challenge.byteLength)return fail(400,'Widevine challenge required');
  if(challenge.byteLength>maxChallenge)return fail(413,'Challenge too large');
  const upstream='https://c.mjh.nz/tvnz-'+ch+'-wv';
  const hdr={'Content-Type':'application/octet-stream','Accept':'application/octet-stream'};
  const deadline=AbortSignal.timeout(14000);
  try{
    const first=await fetch(upstream,{method:'POST',headers:hdr,body:challenge.slice(0),redirect:'manual',signal:deadline});
    let answer=first;
    if(first.status===307||first.status===302){
      const target=allowedTarget(first.headers.get('Location'));
      if(!target)return fail(502,'Unexpected licence redirect');
      answer=await fetch(target.toString(),{method:'POST',headers:hdr,body:challenge,redirect:'manual',signal:deadline});
    }
    if(answer.status===401||answer.status===403)return fail(answer.status,'Upstream licence denied');
    if(!answer.ok)return fail(502,'Upstream licence unavailable');
    const bytes=await answer.arrayBuffer();
    if(bytes.byteLength>maxChallenge*4)return fail(502,'Unexpected licence response size');
    return new Response(bytes,{status:200,headers:{...cors,'Content-Type':'application/octet-stream'}});
  }catch{
    return fail(502,'Licence provider unavailable');
  }
}
export const nzKnownStreamIds=Object.freeze([...rows.keys()]);
