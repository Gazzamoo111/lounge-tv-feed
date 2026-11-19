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
    FROM jsonb_to_recordset(${sql.json(batch)}::jsonb)
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
function epgAttr(tag:string,field:string){
 const m=new RegExp("\\b"+field+"=[\"\x27]([^\"\x27]+)[\"\x27]","i").exec(tag);
 return m?.[1]||"";
}
function epgStamp(value:string):number{
 const m=/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-])(\d{2})(\d{2})/.exec(value);
 if(!m)return 0;
 const ms=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]);
 const off=(+m[8]*60 + +m[9])*60000;
 return ms+(m[7]==="+"?-off:off);
}
function decodeEpg(v:string){return v.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim().slice(0,200);}
async function indexCountry(country:string){
 const valid=new Set(["nz","au","gb","us","ca","fr","de","in","id","my","sg","nl","it","es","pt","br","za","mx","pl","il","tr"]);
 if(!valid.has(country))return {error:"country_not_allowlisted"};
 const origin="iptv-epg.org",src="https://iptv-epg.org/files/epg-"+country+".xml.gz";
 const begin=Date.now();let status=0,wireBytes=0,events=0;
 const channelMap=new Map<string,string>();
 const programs=new Map<string,{count:number,last:number}>();
 try{
  const response=await fetch(src,{headers:{Accept:"application/gzip,application/octet-stream,*/*","User-Agent":"LoungeTV-Guide-QA-Audit/1.0"},signal:AbortSignal.timeout(45000)});
  status=response.status;
  if(!response.ok||!response.body){try{await response.body?.cancel()}catch{}return {country,http_status:status,error:"source_http_error"};}
  const rawReader=response.body.getReader(); const first=await rawReader.read();
  if(first.done||!first.value)return {country,http_status:status,error:"no_bytes"};
  let pending:Uint8Array|null=first.value;
  const source=new ReadableStream<Uint8Array>({
    async pull(ctl){
      if(pending){wireBytes+=pending.byteLength;ctl.enqueue(pending);pending=null;return;}
      const x=await rawReader.read();
      if(x.done){ctl.close();return;}
      wireBytes+=x.value.byteLength;ctl.enqueue(x.value);
    },
    async cancel(reason){try{await rawReader.cancel(reason)}catch{}}
  });
  const gzip=first.value[0]===31&&first.value[1]===139;
  const decoded=(gzip?source.pipeThrough(new DecompressionStream("gzip")):source).getReader();
  const decoder=new TextDecoder();
  let buffer="";const now=Date.now(),until=now+7*86400000;
  while(true){
    const part=await decoded.read();if(part.done)break;
    buffer+=decoder.decode(part.value,{stream:true});
    const re=/<channel\b[^>]*>[\s\S]*?<\/channel>|<programme\b[^>]*>/gi;
    let last=0,m:RegExpExecArray|null;
    while((m=re.exec(buffer))!==null){
      last=re.lastIndex;events++;
      const tag=m[0];
      if(tag.startsWith("<channel")){
        const open=tag.slice(0,tag.indexOf(">")+1),id=epgAttr(open,"id");
        const label=/<display-name(?:\s[^>]*)?>([\s\S]*?)<\/display-name>/i.exec(tag)?.[1]||"";
        if(id&&label)channelMap.set(id,decodeEpg(label));
      }else{
        const id=epgAttr(tag,"channel"),start=epgStamp(epgAttr(tag,"start")),stop=epgStamp(epgAttr(tag,"stop"));
        if(!id||!start||!stop||stop<=now||start>=until||stop<=start)continue;
        const old=programs.get(id)||{count:0,last:0};old.count++;old.last=Math.max(old.last,stop);programs.set(id,old);
      }
    }
    buffer=buffer.slice(last);
    if(buffer.length>64000){
      const pos=Math.max(buffer.lastIndexOf("<channel"),buffer.lastIndexOf("<programme"));
      buffer=pos>=0&&buffer.length-pos<64000?buffer.slice(pos):buffer.slice(-4000);
    }
  }
  if(channelMap.size===0) return {country,http_status:status,error:"no_xmltv_channels",bytes:wireBytes};
  const entries=[...channelMap].map(([xmltv_id,display_name])=>{
    const pr=programs.get(xmltv_id);return {xmltv_id,display_name,upcoming_programmes:pr?.count||0,latest_stop_utc:pr?new Date(pr.last).toISOString():null};
  });
  await sql`DELETE FROM lounge_sync.international_epg_source_channels_qa_20261119 WHERE source_key=${origin} AND country_code=${country}`;
  for(let i=0;i<entries.length;i+=150){
    const part=entries.slice(i,i+150);
    await sql`INSERT INTO lounge_sync.international_epg_source_channels_qa_20261119
       (source_key,country_code,xmltv_id,display_name,upcoming_programmes,latest_stop_utc,sampled_at)
     SELECT ${origin},${country},x.xmltv_id,x.display_name,x.upcoming_programmes,x.latest_stop_utc,now()
     FROM jsonb_to_recordset(${sql.json(part)}::jsonb)
       AS x(xmltv_id text,display_name text,upcoming_programmes integer,latest_stop_utc timestamptz)
     ON CONFLICT(source_key,country_code,xmltv_id) DO UPDATE SET
       display_name=excluded.display_name,upcoming_programmes=excluded.upcoming_programmes,
       latest_stop_utc=excluded.latest_stop_utc,sampled_at=now()`;
  }
  const active=entries.filter(x=>x.upcoming_programmes>0).length;
  await sql`INSERT INTO lounge_sync.international_epg_source_checks_qa_20261119
      (source_key,country_code,http_status,scanned_channels,with_upcoming,bytes_processed,status,notes)
    VALUES(${origin},${country},${status},${entries.length},${active},${wireBytes},'complete',${"metadata-only, no EPG content redistributed"})
    ON CONFLICT(source_key,country_code) DO UPDATE SET checked_at=now(),
       http_status=excluded.http_status,scanned_channels=excluded.scanned_channels,
       with_upcoming=excluded.with_upcoming,bytes_processed=excluded.bytes_processed,
       status=excluded.status,notes=excluded.notes`;
  return {country,http_status:status,channels:entries.length,with_upcoming:active,wire_bytes:wireBytes,
    event_tags:events,elapsed_ms:Date.now()-begin};
 }catch(e){return {country,http_status:status,error:e instanceof Error?e.name:"epg_error",wire_bytes:wireBytes,elapsed_ms:Date.now()-begin};}
}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return reply({error:"not_found"},404);
 try{
  if(!(await permit(req)))return reply({error:"not_found"},404);
  const body=await req.json().catch(()=>null);
  const mode=String(body?.mode||"probe");
  if(!["probe","ingest","account","probe_all","epg_probe","playback_probe","epg_index","provider_guide_probe"].includes(mode))return reply({error:"mode_not_allowed"},400);
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
  if(mode==="playback_probe"){
   const prefixes=Array.isArray(body?.region_prefixes)?body.region_prefixes.map(String):[];
   if(prefixes.length<1||prefixes.length>6||prefixes.some((x:string)=>! /^[A-Z]{2,5}$/.test(x)))
     return reply({error:"invalid_prefixes"},400);
   const selections=await sql`
    SELECT pref.prefix,s.provider_stream_id
    FROM unnest(${prefixes}::text[]) AS pref(prefix)
    LEFT JOIN LATERAL (
      SELECT s.provider_stream_id
      FROM lounge_sync.international_master_selection_qa_20261119 chosen
      JOIN lounge_sync.international_master_streams_qa_20261119 s USING(provider_stream_id)
      JOIN lounge_sync.international_master_categories_qa_20261119 c
        ON c.provider_category_id=s.provider_category_id
      WHERE chosen.tier='primary'
        AND (upper(c.provider_category_name) LIKE pref.prefix||'|%'
          OR upper(c.provider_category_name) LIKE pref.prefix||' |%')
      ORDER BY CASE WHEN s.epg_channel_id<>'' THEN 0 ELSE 1 END,s.provider_stream_id
      LIMIT 1
    ) s ON true
   `;
   const results=[];
   for(const row of selections){
     const id=Number(row.provider_stream_id);
     if(!Number.isSafeInteger(id)||id<=0){results.push({prefix:row.prefix,status:"no_primary_candidate"});continue;}
     const target=c.base+"/live/"+encodeURIComponent(c.username)+"/"+encodeURIComponent(c.password)+"/"+id+".ts";
     const start=Date.now();
     let status=0,bytes=0,kind="unknown",verdict="failed";
     try{
       const response=await fetch(target,{
        headers:{"Range":"bytes=0-4095","Accept":"*/*","User-Agent":"LoungeTV-QA-Transport-Probe/1.0"},
        signal:AbortSignal.timeout(11000)});
       status=response.status;
       if((status===200||status===206)&&response.body){
        const reader=response.body.getReader();
        const first=await reader.read();
        const data=first.value||new Uint8Array();
        bytes=data.byteLength;
        try{await reader.cancel()}catch{}
        const textStart=new TextDecoder().decode(data.slice(0,16));
        if(textStart.startsWith("#EXTM3U"))kind="hls_manifest";
        else if(data[0]===0x47||data[188]===0x47)kind="transport_stream";
        else if(bytes>0)kind="response_bytes";
        verdict=bytes>0?"transport_responded":"empty_body";
       }else{
        try{await response.body?.cancel()}catch{}
        verdict="http_"+status;
       }
     }catch(e){verdict=e instanceof Error?e.name:"network_error";}
     const ms=Date.now()-start;
     await sql`
      INSERT INTO lounge_sync.international_master_transport_probes_qa_20261119
      (provider_stream_id,last_checked_at,http_status,first_data_ms,first_chunk_bytes,transport_kind,verdict)
      VALUES(${id},now(),${status||null},${ms},${bytes},${kind},${verdict})
      ON CONFLICT(provider_stream_id) DO UPDATE SET
       last_checked_at=now(),http_status=EXCLUDED.http_status,
       first_data_ms=EXCLUDED.first_data_ms,first_chunk_bytes=EXCLUDED.first_chunk_bytes,
       transport_kind=EXCLUDED.transport_kind,verdict=EXCLUDED.verdict
     `;
     results.push({prefix:row.prefix,stream_id:id,http_status:status,first_chunk_bytes:bytes,
       first_data_ms:ms,transport_kind:kind,verdict});
   }
   return reply({mode,results});
  }
  if(mode==="provider_guide_probe"){
    const url=new URL(c.base+"/xmltv.php");
    url.searchParams.set("username",c.username);url.searchParams.set("password",c.password);
    const start=Date.now();
    try{
      const res=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{"Accept":"application/xml,text/xml,*/*"}});
      let bytes=0,xmltv=false,html=false,magic:number[]=[];
      if(res.body){
        const reader=res.body.getReader(),first=await reader.read();
        if(first.value){
          bytes=first.value.byteLength;
          magic=Array.from(first.value.slice(0,8));
          const head=new TextDecoder().decode(first.value.slice(0,600)).trimStart();
          xmltv=/^<\\?xml|^<tv[\\s>]/i.test(head);
          html=/^<!doctype html|^<html/i.test(head);
        }
        try{await reader.cancel()}catch{}
      }
      return reply({mode,http_status:res.status,content_type:res.headers.get("content-type"),
        reported_length:res.headers.get("content-length"),first_chunk_bytes:bytes,magic,
        xmltv,html,elapsed_ms:Date.now()-start});
    }catch(e){return reply({mode,error:e instanceof Error?e.name:"network_error"});}
  }
  if(mode==="epg_index"){
    const country=String(body?.country||"").toLowerCase();
    return reply({mode,...await indexCountry(country)});
  }
  if(mode==="epg_probe"){
   const xmlUrl=new URL(c.base+"/xmltv.php");
   xmlUrl.searchParams.set("username",c.username);
   xmlUrl.searchParams.set("password",c.password);
   let xmlStatus=0,xmlLength:null|string=null,xmlType:null|string=null,xmlKind="unavailable";
   try{
     const r=await fetch(xmlUrl,{method:"HEAD",signal:AbortSignal.timeout(14000)});
     xmlStatus=r.status;xmlLength=r.headers.get("content-length");xmlType=r.headers.get("content-type");
     xmlKind=r.ok?"head_ok":"head_"+r.status;
     try{await r.body?.cancel()}catch{}
   }catch(e){xmlKind=e instanceof Error?e.name:"head_error";}
   const samples=await sql`
     SELECT s.provider_stream_id
     FROM lounge_sync.international_master_selection_qa_20261119 chosen
     JOIN lounge_sync.international_master_streams_qa_20261119 s USING(provider_stream_id)
     WHERE s.epg_channel_id<>'' AND chosen.tier='primary'
     ORDER BY s.provider_stream_id LIMIT 3
   `;
   const shortEpg=[];
   for(const row of samples){
     const url=new URL(c.base+"/player_api.php");
     url.searchParams.set("username",c.username);url.searchParams.set("password",c.password);
     url.searchParams.set("action","get_short_epg");
     url.searchParams.set("stream_id",String(row.provider_stream_id));
     url.searchParams.set("limit","4");
     try{
       const res=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{Accept:"application/json"}});
       const data=await res.json().catch(()=>null);
       shortEpg.push({stream_id:Number(row.provider_stream_id),http_status:res.status,
         programme_count:Array.isArray(data?.epg_list)?data.epg_list.length:0,
         response_valid:typeof data==="object"&&data!==null});
     }catch(e){shortEpg.push({stream_id:Number(row.provider_stream_id),error:e instanceof Error?e.name:"fetch_error"});}
   }
   return reply({mode,xmltv:{status:xmlStatus,content_length:xmlLength,content_type:xmlType,kind:xmlKind},short_epg:shortEpg});
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
