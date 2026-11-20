import postgres from "npm:postgres@3.4.7";

/**
 * OIDC-authenticated QA-only guide transport for GitHub Actions.
 * No public provider credentials, user data, programme listings or
 * service-role API keys are committed or returned without GitHub OIDC.
 */
const AUD="loungetv-international-epg-qa";
const REPO="Gazzamoo111/lounge-tv-feed";
const REPO_ID="1382412339";
const BULK_REPO="Gazzamoo111/lounge-tv-player";
const BULK_REPO_ID="1429254511";
const BULK_REF="refs/heads/main";
const BULK_WORKFLOW=BULK_REPO+"/.github/workflows/epg-rolling7-au-247.yml@"+BULK_REF;
// The candidate transport is read-only. The legacy workflow retains its writer.
const REF="refs/heads/qa/international-master-unified-20261119";
const WORKFLOW=REPO+"/.github/workflows/international-master-qa.yml@"+REF;
const BUCKET="lounge-international-epg-qa";
const OBJECT="international-master.xml.gz";
const PROJECT="liqocisegeqzbyuqloql";
const SUPABASE_URL="https://"+PROJECT+".supabase.co";
const noStore={"Cache-Control":"no-store"};
const srk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const raw=Deno.env.get("SUPABASE_DB_URL")||"";
if(!raw||!srk)throw Error("qa_configuration_missing");
const pu=new URL(raw);
pu.hostname="aws-0-ap-southeast-2.pooler.supabase.com";
pu.port="5432";
pu.username="postgres."+PROJECT;
const sql=postgres(pu.toString(),{prepare:false,max:1,connect_timeout:8,idle_timeout:5});
const json=(o:unknown,status=200)=>Response.json(o,{status,headers:noStore});
const fail=()=>json({error:"not_allowed"},403);
function decode64url(s:string){
  const b=s.replace(/-/g,"+").replace(/_/g,"/");
  const bytes=atob(b+"=".repeat((4-b.length%4)%4));
  return Uint8Array.from(bytes,c=>c.charCodeAt(0));
}
async function authorize(req:Request,bulk:boolean){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const pieces=token.split(".");
  if(pieces.length!==3||token.length>12000)return false;
  try{
    const header=JSON.parse(new TextDecoder().decode(decode64url(pieces[0])));
    const claims=JSON.parse(new TextDecoder().decode(decode64url(pieces[1])));
    const now=Math.floor(Date.now()/1000);
    if(header.alg!=="RS256"||typeof header.kid!=="string"||!header.kid)return false;
    if(claims.iss!=="https://token.actions.githubusercontent.com"||claims.aud!==AUD)return false;
    if(claims.repository_visibility!=="public")return false;
    if(bulk){
      if(String(claims.repository)!==BULK_REPO||String(claims.repository_id)!==BULK_REPO_ID||
         claims.ref!==BULK_REF||claims.workflow_ref!==BULK_WORKFLOW||
         !["schedule","workflow_dispatch"].includes(claims.event_name))return false;
    }else if(String(claims.repository)!==REPO||String(claims.repository_id)!==REPO_ID||
            claims.ref!==REF||claims.workflow_ref!==WORKFLOW||claims.event_name!=="push")return false;
    if(Number(claims.exp)<=now||Number(claims.iat)>now+60||
       (claims.nbf!=null&&Number(claims.nbf)>now+60))return false;
    const jwksResp=await fetch("https://token.actions.githubusercontent.com/.well-known/jwks",
      {headers:{Accept:"application/json"},signal:AbortSignal.timeout(10000)});
    if(!jwksResp.ok)return false;
    const keys=(await jwksResp.json()).keys||[];
    const jwk=keys.find((k:any)=>k.kid===header.kid&&k.kty==="RSA");
    if(!jwk)return false;
    const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decode64url(pieces[2]),
      new TextEncoder().encode(pieces[0]+"."+pieces[1]));
  }catch{return false;}
}
async function credentials(){
  const rows=await sql`SELECT decrypted_secret::jsonb AS c
      FROM vault.decrypted_secrets
      WHERE name='lounge_international_master_trial_20261119' LIMIT 1`;
  const c:any=rows[0]?.c;
  if(!c?.server_url||!c?.username||!c?.password)throw Error("provider_qa_missing");
  const base=new URL(c.server_url);
  if(!["http:","https:"].includes(base.protocol))throw Error("bad_upstream");
  return {base:String(c.server_url).replace(/\/+$/,""),
          username:String(c.username),password:String(c.password)};
}
function privateStorage(method:string){
  return SUPABASE_URL+"/storage/v1/object/"+BUCKET+"/"+OBJECT;
}
function storageHeaders(){
  return {"Authorization":"Bearer "+srk,"apikey":srk};
}
async function storageVersion(connection:any){
  const rows=await connection`select version from storage.objects
    where bucket_id=${BUCKET} and name=${OBJECT} limit 1`;
  return String(rows[0]?.version||"");
}

async function writeGuide(req:Request){
  const type=req.headers.get("content-type")||"";
  const len=Number(req.headers.get("content-length")||0);
  if(type!=="application/gzip"||!Number.isSafeInteger(len)||len<1||len>49000000||!req.body)
    return json({error:"compressed_xmltv_required"},400);
  const resp=await fetch(privateStorage("POST"),{
    method:"POST",
    headers:{...storageHeaders(),"Content-Type":"application/gzip",
      "Cache-Control":"max-age=600","x-upsert":"true"},
    body:req.body,signal:AbortSignal.timeout(100000)
  });
  if(!resp.ok)return json({error:"storage_upload_failed",status:resp.status},502);
  await resp.body?.cancel();
  return json({stored:true,status:resp.status});
}

Deno.serve(async(req)=>{
  const url=new URL(req.url);
  const path=url.pathname.split("/").filter(Boolean).slice(-1)[0]||"";
  const bulk=["bulk-baseline","bulk-regional-playlist","bulk-catalogue","bulk-upload"].includes(path);
  if(!await authorize(req,bulk))return fail();
  try{
    if(path==="bulk-baseline"&&req.method==="GET"){
      const before=await storageVersion(sql);
      if(!before)return json({error:"compiled_baseline_missing"},404);
      const response=await fetch(privateStorage("GET"),{
        headers:storageHeaders(),signal:AbortSignal.timeout(60000)
      });
      if(!response.ok||!response.body||before!==await storageVersion(sql)){
        await response.body?.cancel();
        return json({error:"compiled_baseline_unavailable"},409);
      }
      return new Response(response.body,{headers:{
        "Content-Type":"application/gzip","X-Lounge-Guide-Version":before,...noStore
      }});
    }
    if(path==="bulk-upload")return fail();
    if(path==="bulk-catalogue"&&req.method==="GET"){
      // One statement captures the inputs used by the pinned gateway replay.
      // Exclude logos, account information, URLs and programme data.
      const [snapshot]=await sql`
        with active as (
          select id,release_key from lounge_delivery.catalogue_releases
          where state='active' order by activated_at desc nulls last limit 1
        ), curated as (
          select i.external_id,l.live_channel_id,l.canonical_key,l.display_name,l.category,l.subcategory,
                 l.epg_id,l.sort_order,b.provider_stream_id,coalesce(b.source_format,'ts') source_format,
                 p.name provider_name
          from active a join lounge_delivery.live_release_items l on l.release_id=a.id
          join lounge_delivery.item_ids i on i.item_kind='live' and i.canonical_id=l.live_channel_id
          join lounge_delivery.live_source_bindings b
            on b.release_id=l.release_id and b.live_channel_id=l.live_channel_id and b.source_role='primary'
          join public.providers p on p.id=b.provider_id
          where l.admission='keep'
        ), inventory as (
          select i.provider_item_id,i.name,i.epg_channel_id,i.is_adult,coalesce(c.category_name,'') provider_group
          from lounge_sync.best_inventory_items i left join lounge_sync.best_categories c
            on c.kind='live' and c.category_id=i.category_id
          where i.kind='live' and i.is_present=true and i.provider_item_id>0
        )
        select a.id::text,a.release_key,
          (select json_agg(c order by c.sort_order,c.external_id) from curated c) as curated,
          (select json_agg(i order by i.provider_item_id) from inventory i) as inventory,
          (select json_agg(epg_id order by epg_id) from lounge_delivery.shared_epg_channels
           where expires_at>now() and programme_count>0) as guide_ids
        from active a`;
      if(!snapshot?.curated?.length||!snapshot?.inventory?.length||!snapshot?.guide_ids?.length)
        return json({error:"catalogue_snapshot_unavailable"},503);
      return json(snapshot);
    }
    if(path==="recent-playback-audit"&&req.method==="GET"){
      // Diagnostic only. Fixed IDs selected from actual QA playback attempts.
      // No stream URLs, subscriber credentials, tokens or video bytes returned.
      const samples=[
        {region:"Japan",channel:"Star Channel 1",id:1432217},
        {region:"Japan",channel:"NHK BS",id:1432231},
        {region:"Japan",channel:"MTV Japan",id:1432225},
        {region:"Japan",channel:"NHK",id:763888},
        {region:"India",channel:"Colors",id:163527},
        {region:"India",channel:"Aastha Bhajan",id:156041},
        {region:"India",channel:"9X Jalwa",id:156123},
        {region:"India",channel:"& Flix",id:155990},
        {region:"Control",channel:"Sky Sport 1 HD",id:636918}
      ];
      const c=await credentials();
      async function probe(item:{region:string;channel:string;id:number}){
        const stream=c.base+"/live/"+encodeURIComponent(c.username)+"/"+
          encodeURIComponent(c.password)+"/"+item.id+".ts";
        const start=Date.now();
        const ctrl=new AbortController();
        const timer=setTimeout(()=>ctrl.abort(),12000);
        try{
          const r=await fetch(stream,{
            headers:{"Range":"bytes=0-4095","User-Agent":"LoungeTV-BEST-ReadOnly-QA/1.0"},
            signal:ctrl.signal
          });
          let first=new Uint8Array(0);
          if(r.body){
            const reader=r.body.getReader();
            try{
              const x=await reader.read();
              if(!x.done&&x.value)first=x.value.slice(0,4096);
            }finally{try{await reader.cancel()}catch{}}
          }
          const ts=first.length>=377&&first[0]===0x47&&first[188]===0x47&&first[376]===0x47;
          const hls=new TextDecoder().decode(first.slice(0,12)).startsWith("#EXTM3U");
          return {region:item.region,channel:item.channel,id:item.id,http:r.status,
            bytes:first.byteLength,valid_ts_sample:ts,hls_manifest:hls,
            elapsed_ms:Date.now()-start};
        }catch(e){
          return {region:item.region,channel:item.channel,id:item.id,http:0,bytes:0,
            valid_ts_sample:false,hls_manifest:false,
            error:e instanceof Error?e.name:"request_error",elapsed_ms:Date.now()-start};
        }finally{clearTimeout(timer);}
      }
      const results:any[]=[];
      // Keep requests low and deterministic to avoid provider throttling.
      for(let i=0;i<samples.length;i+=3)
        results.push(...await Promise.all(samples.slice(i,i+3).map(probe)));
      return json({
        scope:"recent_international_qa_playback_attempts",
        method:"first_bytes_range_0_4095",
        video_usable_in_nuvio_verified:false,
        results,
        samples_with_ts:results.filter(x=>x.valid_ts_sample).length,
        samples_with_no_data:results.filter(x=>!x.valid_ts_sample&&!x.hls_manifest).length
      });
    }
    if(path==="regional-final-check"&&req.method==="GET"){
      // OIDC only: test four actual Sky redirects and new XMLTV response.
      const c=await credentials();
      const expected=[
        {n:1,external:1895,source:636918},
        {n:2,external:1896,source:1424317},
        {n:3,external:1897,source:1424316},
        {n:9,external:1903,source:636926}
      ];
      const routes=await Promise.all(expected.map(async x=>{
        const dest=SUPABASE_URL+"/functions/v1/lounge-international-regional-qa/live/"+
          encodeURIComponent(c.username)+"/"+encodeURIComponent(c.password)+"/"+x.external+".ts";
        try{
          const r=await fetch(dest,{redirect:"manual",signal:AbortSignal.timeout(15000)});
          const location=r.headers.get("location")||"";
          const actual=Number(location.match(/\/(\d+)\.ts(?:$|\?)/)?.[1]||0);
          try{await r.body?.cancel()}catch{}
          return {channel:x.n,http:r.status,expected_source:x.source,
            actual_source:actual,correct:r.status===302&&actual===x.source};
        }catch(e){return {channel:x.n,http:0,correct:false,
          error:e instanceof Error?e.name:"fetch_error"};}
      }));
      const epgUrl=new URL(SUPABASE_URL+"/functions/v1/lounge-international-regional-qa/xmltv.php");
      epgUrl.searchParams.set("username",c.username);
      epgUrl.searchParams.set("password",c.password);
      let guide:any={http:0,valid:false};
      try{
        const r=await fetch(epgUrl,{headers:{"Accept":"application/xml"},
          signal:AbortSignal.timeout(20000)});
        const reader=r.body?.getReader();
        const x=reader?await reader.read():{done:true,value:null};
        const first=x.value||new Uint8Array(0);
        const head=new TextDecoder().decode(first.slice(0,140));
        guide={http:r.status,scope:r.headers.get("x-lounge-guide-scope"),
          valid:r.status===200&&(head.startsWith("<?xml")||head.startsWith("<tv")||
            (first[0]===31&&first[1]===139))};
        try{await reader?.cancel()}catch{}
      }catch(e){guide={http:0,valid:false,error:e instanceof Error?e.name:"fetch_error"}}
      return json({regional_qa:true,route_checks:routes,epg:guide,
        all_passed:routes.every(x=>x.correct)&&guide.valid});
    }
    if(path==="legacy-playlist"&&req.method==="GET"){
      const c=await credentials();
      const target=new URL(SUPABASE_URL+"/functions/v1/lounge-international-master-v4-qa/get.php");
      target.searchParams.set("username",c.username);
      target.searchParams.set("password",c.password);
      const res=await fetch(target,{headers:{"Accept":"application/x-mpegURL,text/plain,*/*"},
        signal:AbortSignal.timeout(25000)});
      if(!res.ok||!res.body){
        try{await res.body?.cancel()}catch{}
        return json({error:"legacy_playlist_unavailable",status:res.status},502);
      }
      return new Response(res.body,{status:200,headers:{
        "Content-Type":"application/x-mpegURL; charset=utf-8",
        "Cache-Control":"no-store"
      }});
    }
    if((path==="regional-playlist"||path==="bulk-regional-playlist")&&req.method==="GET"){
      // OIDC-only temporary diagnostic; do not log credentials or response.
      const c=await credentials();
      const target=new URL(SUPABASE_URL+"/functions/v1/lounge-international-regional-qa/get.php");
      target.searchParams.set("username",c.username);
      target.searchParams.set("password",c.password);
      const res=await fetch(target,{headers:{"Accept":"application/x-mpegURL,text/plain,*/*"},
        signal:AbortSignal.timeout(25000)});
      if(!res.ok||!res.body){
        try{await res.body?.cancel()}catch{}
        return json({error:"regional_playlist_unavailable",status:res.status},502);
      }
      return new Response(res.body,{status:200,headers:{
        "Content-Type":"application/x-mpegURL; charset=utf-8",
        "Cache-Control":"no-store"
      }});
    }
    if(path==="sky-health"&&req.method==="GET"){
      // Real byte-level provider check, private to this GitHub QA workflow.
      const number=Number(url.searchParams.get("channel")||0);
      if(!Number.isInteger(number)||number<1||number>9)return json({error:"channel_invalid"},400);
      const c=await credentials();
      const ids={FHD:2024779-number,HD:636917+number,NZ_ALTERNATE:1424319-number};
      async function check(quality:string,id:number){
        const dest=c.base+"/live/"+encodeURIComponent(c.username)+"/"+encodeURIComponent(c.password)+"/"+id+".ts";
        const start=Date.now();
        const ctrl=new AbortController();
        const timeout=setTimeout(()=>ctrl.abort(),10000);
        try{
          const result=await fetch(dest,{
            headers:{"Range":"bytes=0-4095","User-Agent":"LoungeTV-Stream-Health-QA/1.0"},
            signal:ctrl.signal
          });
          let first=new Uint8Array(0);
          if(result.body){
            const reader=result.body.getReader();
            try{
              const r=await reader.read();
              if(!r.done&&r.value)first=r.value.slice(0,4096);
            }finally{try{await reader.cancel()}catch{}}
          }
          const ts=first.length>376&&first[0]===0x47&&first[188]===0x47;
          const hls=new TextDecoder().decode(first.slice(0,12)).startsWith("#EXTM3U");
          return {quality,id,http:result.status,bytes:first.length,ts_sync:ts,
            hls_manifest:hls,elapsed_ms:Date.now()-start};
        }catch(e){
          return {quality,id,http:0,bytes:0,ts_sync:false,hls_manifest:false,
            error:e instanceof Error?e.name:"fetch_error",
            elapsed_ms:Date.now()-start};
        }finally{clearTimeout(timeout);}
      }
      const result=await Promise.all(Object.entries(ids).map(([quality,id])=>check(quality,id)));
      return json({channel:number,source:"BEST",sample_only:true,
        results:result,full_playback_verified:false});
    }
    if(path==="selection"&&req.method==="GET"){
      const rows=await sql`
        SELECT s.provider_stream_id::text AS stream_id,
               s.epg_channel_id AS epg_id,
               s.original_name AS name
        FROM lounge_sync.international_master_selection_qa_20261119 chosen
        JOIN lounge_sync.international_master_streams_qa_20261119 s
          USING(provider_stream_id)
        WHERE chosen.tier='primary'
          AND s.epg_channel_id NOT IN ('','0')
        ORDER BY s.provider_stream_id
      `;
      return json(rows);
    }
    if(path==="shared-index"&&req.method==="GET"){
      // DB-only lookup avoids streaming the complete ~90MB shared XMLTV
      // and avoids worker wall-time failures on large selected XMLTV.
      const ids=await sql`
        SELECT DISTINCT guide.epg_id
        FROM lounge_delivery.shared_epg_channels guide
        WHERE guide.programme_count>0 AND guide.expires_at>now()
          AND (
            EXISTS (
              SELECT 1 FROM lounge_sync.international_master_streams_qa_20261119 s
              JOIN lounge_sync.international_master_selection_qa_20261119 chosen
                USING(provider_stream_id)
              WHERE chosen.tier='primary'
                AND s.epg_channel_id=guide.epg_id
            )
            OR EXISTS(
              SELECT 1 FROM lounge_delivery.live_release_items l
              WHERE l.epg_id=guide.epg_id AND l.admission='keep'
            )
          )
        ORDER BY guide.epg_id
      `;
      return json({ids:ids.map((x:any)=>String(x.epg_id)),scope:"selected-qa-shared"});
    }
    if(path==="shared-batch"&&req.method==="GET"){
      const ids=url.searchParams.getAll("id");
      if(ids.length<1||ids.length>25||ids.some(x=>x.length<1||x.length>200))
        return json({error:"bad_ids"},400);
      const chunks=await sql`
        SELECT xmltv FROM lounge_delivery.shared_epg_channels
        WHERE epg_id=any(${ids}::text[])
          AND programme_count>0 AND expires_at>now()
        ORDER BY epg_id
      `;
      const xml='<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n'
        +chunks.map((x:any)=>String(x.xmltv||"")).join("\n")+'\n</tv>';
      return new Response(xml,{status:200,headers:{
        "Content-Type":"application/xml; charset=utf-8",...noStore
      }});
    }
    if((path==="best"||path==="shared")&&req.method==="GET"){
      const c=await credentials();
      const target=path==="best"
        ?new URL(c.base+"/xmltv.php")
        :new URL(SUPABASE_URL+"/functions/v1/lounge-international-master-v4-qa/xmltv.php");
      target.searchParams.set("username",c.username);
      target.searchParams.set("password",c.password);
      const resp=await fetch(target,{headers:{Accept:"application/xml,text/xml,*/*",
        "User-Agent":"LoungeTV-EpgBroker-QA/1.0"},signal:AbortSignal.timeout(135000)});
      if(!resp.ok||!resp.body){
        try{await resp.body?.cancel()}catch{}
        return json({error:"guide_upstream_unavailable",http:resp.status},502);
      }
      return new Response(resp.body,{status:200,headers:{
        "Content-Type":"application/xml; charset=utf-8",
        ...noStore
      }});
    }
    if(path==="upload"&&req.method==="PUT"){
      return await writeGuide(req);
    }
    if(path==="gateway-probe"&&req.method==="GET"){
      // Check actual customer-facing QA EPG, without storing its large body
      // in Postgres or returning credentials in diagnostic results.
      const c=await credentials();
      const endpoint=new URL(SUPABASE_URL+"/functions/v1/lounge-international-master-v4-qa/xmltv.php");
      endpoint.searchParams.set("username",c.username);
      endpoint.searchParams.set("password",c.password);
      const started=Date.now();
      const resp=await fetch(endpoint,{
        headers:{"Accept":"application/xml,text/xml,*/*","Accept-Encoding":"gzip"},
        signal:AbortSignal.timeout(25000)
      });
      const scope=resp.headers.get("x-lounge-guide-scope");
      const contentType=resp.headers.get("content-type")||"";
      const encoding=resp.headers.get("content-encoding")||"";
      let sample=new Uint8Array(0);
      if(resp.body){
        const reader=resp.body.getReader();
        const first=await reader.read();
        if(!first.done&&first.value)sample=first.value.slice(0,2048);
        try{await reader.cancel()}catch{}
      }
      const head=new TextDecoder().decode(sample.slice(0,160));
      const looksXml=head.startsWith('<?xml')||head.startsWith('<tv');
      const looksGzip=sample[0]===31&&sample[1]===139;
      return json({gateway_http:resp.status,scope,content_type:contentType,
        content_encoding:encoding,sampled_bytes:sample.length,
        stream_signature_valid:looksXml||looksGzip,
        compiled_private_qa:resp.ok&&scope==="compiled-private-qa"&&(looksXml||looksGzip),
        elapsed_ms:Date.now()-started,production_untouched:true});
    }
    if(path==="status"&&req.method==="GET"){
      const resp=await fetch(privateStorage("HEAD"),{
        method:"HEAD",headers:storageHeaders(),signal:AbortSignal.timeout(12000)});
      if(!resp.ok)return json({stored:false,http:resp.status},404);
      return json({stored:true,bytes:Number(resp.headers.get("content-length")||0),
        updated_at:resp.headers.get("last-modified")||null});
    }
    return json({error:"not_found"},404);
  }catch(e){return json({error:"qa_processing_unavailable",
    kind:e instanceof Error?e.name:"unknown"},502);}
});
