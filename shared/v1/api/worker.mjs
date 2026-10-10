/*
 * Lounge TV shared content API v1, staging only.
 * The content store is private R2; credentials and stream URLs are not returned.
 * Existing devices/subscriptions in Supabase remain authoritative.
 */
const routes={"/v1/manifest":"manifest.json","/v1/catalogue":"live.json","/v1/vod":"vod.json","/v1/epg":"epg.json"};
const baseHeaders={"Access-Control-Allow-Origin":"*","Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8","Vary":"X-Device-Id"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:baseHeaders});

async function hash(token){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,"0")).join("");
}
async function find(env,table,params){
  const url=new URL(String(env.SUPABASE_URL).replace(/\/$/,"")+"/rest/v1/"+table);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  const response=await fetch(url,{
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY}
  });
  if(!response.ok)throw Error("Supabase request failed");
  return response.json();
}
async function entitled(request,env){
  const id=(request.headers.get("X-Device-Id")||"").trim();
  const token=(request.headers.get("X-Device-Token")||"").trim();
  if(!/^[a-f0-9-]{36}$/i.test(id)||token.length<32||token.length>256)return false;
  const secrets=await find(env,"device_secrets",{select:"token_hash",device_id:"eq."+id,limit:"1"});
  if(secrets.length!==1||secrets[0].token_hash!==await hash(token))return false;
  const device=await find(env,"devices",{select:"user_id,status",id:"eq."+id,limit:"1"});
  if(device.length!==1||device[0].status!=="active")return false;
  const plans=await find(env,"subscriptions",{select:"id,current_period_end",user_id:"eq."+device[0].user_id,status:"eq.active",limit:"10"});
  const now=Date.now();
  for(const plan of plans){
    if(plan.current_period_end&&Date.parse(plan.current_period_end)<=now)continue;
    const services=await find(env,"service_assignments",{select:"expires_at",subscription_id:"eq."+plan.id,status:"eq.active",limit:"10"});
    if(services.some(s=>!s.expires_at||Date.parse(s.expires_at)>now))return true;
  }
  return false;
}
export default {
  async fetch(request,env){
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{
      "Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers":"X-Device-Id,X-Device-Token,Content-Type"}});
    if(request.method!=="GET"&&request.method!=="HEAD")return reply({error:"Method not allowed"},405);
    const path=new URL(request.url).pathname;
    if(path==="/v1/health")return reply({ok:true,enabled:env.CONTENT_ENABLED==="true"});
    if(!routes[path])return reply({error:"Not found"},404);
    if(env.CONTENT_ENABLED!=="true")return reply({error:"Content not yet published"},503);
    if(!env.CONTENT||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return reply({error:"Service not configured"},503);
    let allowed=false;
    try{allowed=await entitled(request,env);}catch(_){return reply({error:"Authorisation unavailable"},503);}
    if(!allowed)return reply({error:"Inactive device or subscription"},401);
    const pointer=await env.CONTENT.get("shared/v1/current.json");
    if(!pointer)return reply({error:"No catalogue published"},503);
    let revision;
    try{revision=JSON.parse(await pointer.text()).revision;}catch(_){return reply({error:"Invalid catalogue pointer"},503);}
    if(!/^[A-Za-z0-9._-]{8,64}$/.test(revision||""))return reply({error:"Invalid revision"},503);
    const file=await env.CONTENT.get("shared/v1/releases/"+revision+"/"+routes[path]);
    if(!file)return reply({error:"Content not found"},503);
    const headers={...baseHeaders,ETag:file.httpEtag||'"'+revision+'"',"X-Lounge-Catalogue-Revision":revision};
    if(request.headers.get("If-None-Match")===headers.ETag)return new Response(null,{status:304,headers});
    return new Response(request.method==="HEAD"?null:file.body,{status:200,headers});
  }
};