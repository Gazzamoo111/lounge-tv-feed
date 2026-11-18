import postgres from "npm:postgres@3.4.7";

/**
 * Isolated BEST International Master QA ingestion.
 * Enforced one-time invocation tokens are minted in the private database.
 * No trial credentials, stream URLs, or secret keys are accepted over HTTP or emitted.
 * Never writes to production channel, release or inventory tables.
 */
const raw = Deno.env.get("SUPABASE_DB_URL");
if (!raw) throw Error("db_unavailable");
const u = new URL(raw);
u.hostname="aws-0-ap-southeast-2.pooler.supabase.com";
u.port="5432";
u.username="postgres.liqocisegeqzbyuqloql";
const sql=postgres(u.toString(),{prepare:false,max:1,connect_timeout:8,idle_timeout:5});
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
async function sha256(raw:string){
 const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
 return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function permit(req:Request){
 const token=req.headers.get("x-lounge-qa-once")||"";
 if(!/^[0-9a-f]{64}$/.test(token))return false;
 const h=await sha256(token);
 const rows=await sql`
  UPDATE lounge_sync.international_master_ingest_nonces_qa_20261119
  SET used_at=now()
  WHERE token_hash=${h} AND used_at IS NULL AND expires_at>now()
  RETURNING token_hash
 `;
 return rows.length===1;
}
async function loadCredentials(){
 const rows=await sql`
  SELECT decrypted_secret::jsonb AS c
  FROM vault.decrypted_secrets
  WHERE name='lounge_international_master_trial_20261119'
  LIMIT 1
 `;
 const c:any=rows[0]?.c;
 if(!c?.server_url||!c?.username||!c?.password)throw Error("trial_credentials_missing");
 const url=new URL(String(c.server_url));
 if(!["http:","https:"].includes(url.protocol))throw Error("bad_provider_scheme");
 return {base:String(c.server_url).replace(/\/+$/,""),username:String(c.username),password:String(c.password)};
}
type ProviderCredentials={base:string;username:string;password:string};
async function fetchBest(c:ProviderCredentials,action:string,category:string|null){
 const url=new URL(c.base+"/player_api.php");
 url.searchParams.set("username",c.username);
 url.searchParams.set("password",c.password);
 if(action)url.searchParams.set("action",action);
 if(category)url.searchParams.set("category_id",category);
 const start=Date.now();
 try{
  const res=await fetch(url,{method:"GET",headers:{Accept:"application/json","User-Agent":"LoungeTV-International-QA-Catalogue/1.0"},signal:AbortSignal.timeout(27000)});
  if(!res.ok){
   try{await res.body?.cancel()}catch{}
   return {http:res.status,elapsed:Date.now()-start,items:null,kind:"http_"+res.status};
  }
  let content:any;
  try{content=await res.json()}catch{content=null}
  if(!Array.isArray(content))return {http:res.status,elapsed:Date.now()-start,items:null,kind:"response_not_array"};
  return {http:res.status,elapsed:Date.now()-start,items:content,kind:"ok"};
 }catch(e){
  return {http:0,elapsed:Date.now()-start,items:null,kind:e instanceof Error?e.name:"network_error"};
 }
}
async function writeCategory(id:string, result:{http:number;elapsed:number;items:any[]|null;kind:string}){
 let rows=0;
 if(result.items){
  const uniqueIds=new Map<number,any>();
  for(const item of result.items){
   const streamId=Number(item?.stream_id);
   if(!Number.isSafeInteger(streamId)||streamId<=0||streamId>=147000000)continue;
   if(String(item?.is_adult||"0")==="1")continue;
   const name=String(item?.name||"").trim().slice(0,350);
   if(!name)continue;
   const categoryId=String(item?.category_id||id).trim();
   if(categoryId!==id)continue; // do not mislabel a source to a territory
   uniqueIds.set(streamId,{
    id:streamId,category_id:categoryId,name,
    logo:String(item?.stream_icon||"").slice(0,1200),
    epg:String(item?.epg_channel_id||"").slice(0,250)
   });
  }
  const filtered=[...uniqueIds.values()];
  // Bounded inserts keep database pressure low on Supabase free tier.
  for(let start=0;start<filtered.length;start+=150){
   const batch=filtered.slice(start,start+150);
   await sql`
    INSERT INTO lounge_sync.international_master_streams_qa_20261119
      (provider_stream_id,provider_category_id,original_name,artwork_url,epg_channel_id,stream_type,seen_at)
    SELECT x.id,x.category_id,x.name,x.logo,x.epg,'live',now()
    FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb)
      AS x(id bigint,category_id text,name text,logo text,epg text)
    ON CONFLICT (provider_stream_id) DO UPDATE SET
      provider_category_id=EXCLUDED.provider_category_id,
      original_name=EXCLUDED.original_name,
      artwork_url=EXCLUDED.artwork_url,
      epg_channel_id=EXCLUDED.epg_channel_id,
      seen_at=EXCLUDED.seen_at
   `;
   rows+=batch.length;
  }
 }
 await sql`
  INSERT INTO lounge_sync.international_master_ingest_runs_qa_20261119
    (category_id,last_attempt_at,last_http_status,result_count,status,error_kind,duration_ms)
  VALUES (${id},now(),${result.http||null},${rows},${result.kind==="ok"?"complete":"failed"},${result.kind==="ok"?null:result.kind},${result.elapsed})
  ON CONFLICT (category_id) DO UPDATE SET
    last_attempt_at=EXCLUDED.last_attempt_at,
    last_http_status=EXCLUDED.last_http_status,
    result_count=EXCLUDED.result_count,
    status=EXCLUDED.status,
    error_kind=EXCLUDED.error_kind,
    duration_ms=EXCLUDED.duration_ms
 `;
 return rows;
}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return reply({error:"not_found"},404);
 try{
  if(!(await permit(req)))return reply({error:"not_found"},404);
  const body=await req.json().catch(()=>null);
  const mode=String(body?.mode||"probe");
  if(!["probe","ingest","account","probe_all"].includes(mode))return reply({error:"mode_not_allowed"},400);
  const c=await loadCredentials();
  if(mode==="account"){
   const url=new URL(c.base+"/player_api.php");
   url.searchParams.set("username",c.username);
   url.searchParams.set("password",c.password);
   const res=await fetch(url,{signal:AbortSignal.timeout(12000)});
   const a=await res.json().catch(()=>({}));
   return reply({status:res.status,active:Number(a?.user_info?.auth)===1,
     account_status:String(a?.user_info?.status||"unknown"),
     expires_at:a?.user_info?.exp_date?new Date(Number(a.user_info.exp_date)*1000).toISOString():null});
  }
  if(mode==="probe_all"){
   const url=new URL(c.base+"/player_api.php");
   url.searchParams.set("username",c.username);url.searchParams.set("password",c.password);
   url.searchParams.set("action","get_live_streams");
   const start=Date.now();
   try{
    const res=await fetch(url,{signal:AbortSignal.timeout(27000),headers:{Accept:"application/json","User-Agent":"LoungeTV-International-QA-Catalogue/1.0"}});
    const length=res.headers.get("content-length");
    try{await res.body?.cancel()}catch{}
    return reply({mode,http_status:res.status,content_length:length,elapsed_ms:Date.now()-start});
   }catch(e){return reply({mode,error:e instanceof Error?e.name:"fetch_error"});}
  }
  const categoryIds=Array.isArray(body?.category_ids)?body.category_ids.map(String):[];
  if(categoryIds.length<1||categoryIds.length>8||categoryIds.some(x=>!/^\d{1,7}$/.test(x)))return reply({error:"category_ids_invalid"},400);
  const unique=[...new Set(categoryIds)];
  const known=await sql`SELECT provider_category_id FROM lounge_sync.international_master_categories_qa_20261119 WHERE provider_category_id=ANY(${unique}::text[])`;
  if(known.length!==unique.length)return reply({error:"category_not_in_trial_snapshot"},400);
  const result:any[]=[];
  for(const id of unique){
   const hit=await fetchBest(c,"get_live_streams",id);
   let saved=0;
   if(mode==="ingest")saved=await writeCategory(id,hit);
   result.push({category_id:id,http_status:hit.http,returned:Array.isArray(hit.items)?hit.items.length:null,
    saved:mode==="ingest"?saved:null,elapsed_ms:hit.elapsed,error:hit.kind==="ok"?null:hit.kind});
   if(hit.http===451)break;
  }
  return reply({mode,categories:result});
 }catch(e){
  console.error("QA_IMPORT_FAIL",e instanceof Error?e.name:"error");
  return reply({error:e instanceof Error?e.name:"internal_error",sqlstate:typeof (e as any)?.code==="string"?(e as any).code:null},500);
 }
});
