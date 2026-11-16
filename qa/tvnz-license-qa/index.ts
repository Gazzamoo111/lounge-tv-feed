// QA-only, constrained Widevine POST redirect relay for the two NZ Freeview TVNZ channels.
// The device still completes its normal Widevine CDM exchange with the upstream licence
// service. No decryption, keys or access credentials are stored or exposed.
// An upstream refusal is returned as a refusal; never substitute a key.
const BY_CHANNEL: Record<string,string> = {
  "1":"https://c.mjh.nz/tvnz-1-wv",
  "2":"https://c.mjh.nz/tvnz-2-wv",
};
const ALLOWED_REDIRECT_HOST="fvnz-capi-prod.switch.tv";
const ALLOWED_REDIRECT_PATH="/playback-api/getlicense";
const MAX_CHALLENGE=128*1024;
function raw(status:number,body:string,stage:string):Response {
  return new Response(body,{status,headers:{
    "Cache-Control":"no-store","Content-Type":"text/plain; charset=utf-8",
    "X-Lounge-Tvnz-Stage":stage,"Access-Control-Allow-Origin":"*",
  }});
}
function allowedRedirect(value:string):URL|null {
  try {
    const u=new URL(value);
    if(u.protocol!=="https:" || u.hostname!==ALLOWED_REDIRECT_HOST ||
       u.pathname!==ALLOWED_REDIRECT_PATH || u.username || u.password ||
       !["auth","kid","ptoken","service","version"].every(k=>u.searchParams.has(k))) return null;
    return u;
  } catch {return null;}
}
async function handle(req:Request):Promise<Response> {
  const url=new URL(req.url);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"POST,OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type,Accept,User-Agent",
    "Cache-Control":"no-store",
  }});
  if(req.method!=="POST")return raw(405,"POST required","method");
  const ch=url.searchParams.get("ch")||"";
  const upstream=BY_CHANNEL[ch];
  if(!upstream)return raw(404,"Unknown channel","channel");
  const length=Number(req.headers.get("content-length")||"0");
  if(!Number.isFinite(length)||length>MAX_CHALLENGE)return raw(413,"Challenge too large","size");
  let challenge:ArrayBuffer;
  try {
    challenge=await req.arrayBuffer();
    if(challenge.byteLength>MAX_CHALLENGE) return raw(413,"Challenge too large","size");
    if(!challenge.byteLength)return raw(400,"Widevine challenge required","challenge");
  }catch{return raw(400,"Invalid challenge","challenge");}
  const methodHeaders:HeadersInit={"Content-Type":"application/octet-stream",
    "Accept":"application/octet-stream"};
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),14000);
  try {
    // Resolve a fresh, short-lived signed URL for each request.
    const first=await fetch(upstream,{method:"POST",headers:methodHeaders,
      body:challenge.slice(0),redirect:"manual",signal:abort.signal});
    if(first.status!==307 && first.status!==302){
      // Do not transform a challenge response or pretend the upstream accepted it.
      if(first.status>=200&&first.status<300)
        return new Response(await first.arrayBuffer(),{status:first.status,headers:{
          "Content-Type":"application/octet-stream","Cache-Control":"no-store",
          "X-Lounge-Tvnz-Stage":"direct","Access-Control-Allow-Origin":"*",
        }});
      console.warn("TVNZ_LICENCE_UPSTREAM_REFUSED",ch,first.status);
      return raw(502,"Upstream licence unavailable","upstream");
    }
    const location=first.headers.get("location");
    const target=location?allowedRedirect(location):null;
    if(!target)return raw(502,"Unexpected upstream licence redirect","redirect");
    // Follow 307 on the server, preserving the POST method and original DRM challenge.
    const response=await fetch(target.toString(),{method:"POST",
      headers:methodHeaders,body:challenge,redirect:"manual",signal:abort.signal});
    if(response.status>=200&&response.status<300){
      const b=await response.arrayBuffer();
      if(b.byteLength>MAX_CHALLENGE*4)return raw(502,"Unexpected licence size","response");
      return new Response(b,{status:response.status,headers:{
        "Content-Type":"application/octet-stream","Cache-Control":"no-store",
        "X-Lounge-Tvnz-Stage":"complete","Access-Control-Allow-Origin":"*",
      }});
    }
    console.warn("TVNZ_LICENCE_DENIED",ch,response.status);
    return raw(response.status===401||response.status===403?response.status:502,
      "Upstream licence was not granted","denied");
  }catch(e){
    console.error("TVNZ_LICENCE_RELAY_ERROR",ch,String(e).slice(0,160));
    return raw(502,"Licence relay unavailable","network");
  }finally{clearTimeout(timer);}
}
Deno.serve(handle);
