import postgres from "npm:postgres@3.4.7";
import {rewriteLoungeM3u,TOKEN_RE} from "./link-core.mjs";
const base=(Deno.env.get("SUPABASE_URL")||"https://liqocisegeqzbyuqloql.supabase.co").replace(/\/+$/,"");
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const rawDbUrl=Deno.env.get("SUPABASE_DB_URL");
if(!rawDbUrl)throw new Error("Missing database configuration");
function pool(raw:string){
 const u=new URL(raw),seg=u.hostname.split(".");
 u.hostname="aws-0-ap-southeast-2.pooler.supabase.com";u.port="5432";
 u.username="postgres."+(seg.length>1?seg[1]:"liqocisegeqzbyuqloql");
 return u.toString();
}
const sql=postgres(pool(rawDbUrl),{prepare:false,max:1,idle_timeout:5,connect_timeout:10});
const upstream=base+"/functions/v1/n",publicBase=base+"/functions/v1/lounge-customer-playlist-qa";
const licenseBase=base+"/functions/v1/tvnz-license-qa";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA=/^[1-9][0-9]{0,11}\.(ts|m3u8)$/;
const headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
function json(payload:unknown,status=200){
 return new Response(JSON.stringify(payload),{status,headers:{...headers,"Content-Type":"application/json; charset=utf-8"}});
}
const denied=()=>json({error:"Link unavailable or expired"},401);
async function hash(value:string){
 const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
 return [...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function randomLinkKey(){
 const b=crypto.getRandomValues(new Uint8Array(32));
 return btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
async function getAdmin(req:Request){
 const token=(req.headers.get("Authorization")||"").match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
 if(!token||!serviceKey)return null;
 const r=await fetch(base+"/auth/v1/user",{headers:{Authorization:"Bearer "+token,apikey:serviceKey},signal:AbortSignal.timeout(10000)});
 if(!r.ok)return null;
 const user=await r.json().catch(()=>null);
 if(!UUID.test(String(user?.id||"")))return null;
 const rows=await sql`select role from public.admin_users where user_id=${user.id}::uuid limit 1`;
 return rows.length?user.id:null;
}
async function eligibleService(id:string){
 const rows=await sql`
 select sa.expires_at service_expiry,s.current_period_end subscription_expiry,
        pa.id provider_account_id,pa.expires_at provider_expiry
 from public.service_assignments sa
 join public.subscriptions s on s.id=sa.subscription_id and s.status='active'
 join public.service_assignment_internal sia on sia.service_assignment_id=sa.id
 join public.provider_accounts pa on pa.id=sia.provider_account_id
 join public.providers p on p.id=pa.provider_id and p.name='BEST'
 where sa.id=${id}::uuid and sa.status='active'
   and (sa.expires_at is null or sa.expires_at>now())
   and (s.current_period_end is null or s.current_period_end>now())
   and pa.status in ('assigned','active')
   and (pa.expires_at is null or pa.expires_at>now())
 order by sia.assigned_at desc limit 1`;
 return rows[0]||null;
}
async function access(token:string){
 if(!TOKEN_RE.test(token))return null;
 const sha=await hash(token);
 const rows=await sql`
 select l.id,l.provider_account_id
 from lounge_delivery.qa_customer_playlist_links l
 join public.service_assignments sa on sa.id=l.service_assignment_id and sa.status='active'
 join public.subscriptions s on s.id=sa.subscription_id and s.status='active'
 join public.service_assignment_internal sia
   on sia.service_assignment_id=sa.id and sia.provider_account_id=l.provider_account_id
 join public.provider_accounts pa on pa.id=l.provider_account_id and pa.status in ('assigned','active')
 join public.providers p on p.id=pa.provider_id and p.name='BEST'
 where l.token_hash=${sha} and l.status='active' and l.revoked_at is null and l.expires_at>now()
   and (sa.expires_at is null or sa.expires_at>now())
   and (s.current_period_end is null or s.current_period_end>now())
   and (pa.expires_at is null or pa.expires_at>now())
 limit 1`;
 return rows[0]||null;
}
async function getCreds(id:string){
 const rows=await sql`select server_url,provider_username,provider_password
   from public.get_provider_credentials_for_account(${id}::uuid) limit 1`;
 const r=rows[0];
 if(!r?.server_url||!r?.provider_username||!r?.provider_password)return null;
 return {server:String(r.server_url).replace(/\/+$/,""),username:String(r.provider_username),password:String(r.provider_password)};
}
async function admin(req:Request,action:string){
 if(req.method!=="POST")return json({error:"POST required"},405);
 const who=await getAdmin(req);
 if(!who)return json({error:"Admin authentication required"},401);
 const body=await req.json().catch(()=>null);
 if(!body||typeof body!=="object")return json({error:"Invalid request"},400);
 if(action==="issue"){
  const sid=String(body.service_assignment_id||"");
  if(!UUID.test(sid))return json({error:"Service assignment ID required"},400);
  const svc=await eligibleService(sid);
  if(!svc)return json({error:"Active assigned customer service not found"},409);
  if(!(await getCreds(svc.provider_account_id)))return json({error:"Provider credentials not provisioned"},409);
  const days=Number(body.expires_in_days??30);
  if(!Number.isInteger(days)||days<1||days>90)return json({error:"Expiry must be 1–90 days"},400);
  const dates=[Date.now()+days*86400000,svc.service_expiry,svc.subscription_expiry,svc.provider_expiry]
   .filter(x=>x!==null&&x!==undefined)
   .map(x=>typeof x==="number"?x:new Date(x).getTime()).filter(Number.isFinite);
  const expires=Math.min(...dates);
  if(expires<=Date.now()+60000)return json({error:"Service expires too soon"},409);
  const key=randomLinkKey(),sha=await hash(key);
  const label=String(body.label||"Lounge TV").trim().slice(0,64)||"Lounge TV";
  const rows=await sql`insert into lounge_delivery.qa_customer_playlist_links
   (service_assignment_id,provider_account_id,token_hash,label,expires_at,issued_by)
   values (${sid}::uuid,${svc.provider_account_id}::uuid,${sha},${label},
           ${new Date(expires).toISOString()}::timestamptz,${who}::uuid)
   returning id,expires_at`;
  return json({ok:true,link_id:rows[0].id,url:publicBase+"/playlist/"+key,
               expires_at:rows[0].expires_at,note:"This revocable link is a bearer secret"},201);
 }
 if(action==="revoke"){
  const id=String(body.link_id||"");
  if(!UUID.test(id))return json({error:"Link ID required"},400);
  const rows=await sql`update lounge_delivery.qa_customer_playlist_links
   set status='revoked',revoked_at=coalesce(revoked_at,now())
   where id=${id}::uuid returning id`;
  return rows.length?json({ok:true,link_id:id,status:"revoked"}):json({error:"Link not found"},404);
 }
 if(action==="list"){
  const sid=String(body.service_assignment_id||"");
  if(!UUID.test(sid))return json({error:"Service assignment ID required"},400);
  const rows=await sql`select id,label,status,expires_at,created_at,revoked_at
   from lounge_delivery.qa_customer_playlist_links
   where service_assignment_id=${sid}::uuid order by created_at desc limit 60`;
  return json({links:rows});
 }
 return json({error:"Unknown action"},404);
}
function coreUrl(creds:{username:string,password:string},path:string){
 const u=new URL(upstream+"/"+path);
 u.searchParams.set("username",creds.username);u.searchParams.set("password",creds.password);
 return u;
}
async function serve(req:Request,parts:string[]){
 const [kind,key,detail]=parts;
 if(!TOKEN_RE.test(String(key||"")))return denied();
 const granted=await access(key);
 if(!granted)return denied();
 if(kind==="license"&&parts.length===3){
  if(req.method!=="POST"||!["1","2"].includes(detail))return json({error:"Invalid licence request"},405);
  const supplied=Number(req.headers.get("content-length")||0);
  if(supplied>131072)return json({error:"Challenge too large"},413);
  const bytes=await req.arrayBuffer();
  if(bytes.byteLength===0||bytes.byteLength>131072)return json({error:"Invalid challenge"},400);
  const r=await fetch(licenseBase+"?ch="+detail,{method:"POST",
   headers:{"Content-Type":"application/octet-stream"},body:bytes,signal:AbortSignal.timeout(22000)});
  return new Response(r.body,{status:r.status,headers:{...headers,"Content-Type":r.headers.get("Content-Type")||"application/octet-stream"}});
 }
 if(req.method!=="GET"&&req.method!=="HEAD")return json({error:"Method not allowed"},405);
 const creds=await getCreds(granted.provider_account_id);
 if(!creds)return denied();
 if(kind==="playlist"&&parts.length===2){
  const url=coreUrl(creds,"get.php");
  url.searchParams.set("type","m3u_plus");url.searchParams.set("output","ts");
  const r=await fetch(url,{headers:{"Accept":"application/x-mpegURL"},signal:AbortSignal.timeout(35000)});
  if(!r.ok)return json({error:"Source playlist unavailable"},502);
  const source=await r.text();
  if(source.length>16000000)return json({error:"Playlist exceeds limit"},502);
  const {result}=rewriteLoungeM3u(source,{token:key,publicBase,coreBase:upstream,
    username:creds.username,password:creds.password});
  return new Response(req.method==="HEAD"?null:result,{headers:{...headers,
    "Content-Type":"application/x-mpegURL; charset=utf-8","X-Lounge-Mode":"customer-token-qa"}});
 }
 if(kind==="epg"&&parts.length===2){
  const r=await fetch(coreUrl(creds,"xmltv.php"),{headers:{"Accept":"application/xml"},
    signal:AbortSignal.timeout(35000)});
  if(!r.ok)return json({error:"Guide unavailable"},502);
  return new Response(req.method==="HEAD"?null:r.body,{headers:{...headers,
    "Content-Type":"application/xml; charset=utf-8"}});
 }
 if(kind==="live"&&parts.length===3&&MEDIA.test(detail||"")){
  const path="live/"+encodeURIComponent(creds.username)+"/"+encodeURIComponent(creds.password)+"/"+detail;
  const r=await fetch(coreUrl(creds,path),{redirect:"manual",signal:AbortSignal.timeout(22000)});
  if(![301,302,307,308].includes(r.status))return json({error:"Stream unavailable"},502);
  const raw=r.headers.get("location");
  if(!raw)return json({error:"Stream unavailable"},502);
  const target=new URL(raw),approved=new URL(creds.server);
  const prefix="/live/"+encodeURIComponent(creds.username)+"/"+encodeURIComponent(creds.password)+"/";
  if(target.origin!==approved.origin||!target.pathname.startsWith(prefix)||
    !MEDIA.test(target.pathname.slice(prefix.length))||target.search||target.hash)
    return json({error:"Unexpected provider destination"},502);
  return new Response(null,{status:302,headers:{...headers,Location:target.toString()}});
 }
 return json({error:"Not found"},404);
}
Deno.serve(async(req:Request)=>{
 try{
  const url=new URL(req.url),marker="/lounge-customer-playlist-qa/";
  const route=url.pathname.includes(marker)?url.pathname.split(marker)[1]:"";
  if(route==="health"&&req.method==="GET")return json({ok:true,environment:"qa",auth:"customer-hashed-token"});
  if(route.startsWith("admin/"))return await admin(req,route.slice(6));
  return await serve(req,route.split("/").filter(Boolean));
 }catch(e){
  console.error("LOUNGE_CUSTOMER_QA",e instanceof Error?e.name:"runtime");
  return json({error:"Service unavailable"},503);
 }
});