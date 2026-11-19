import postgres from "npm:postgres@3.4.7";

/**
 * OIDC-authenticated QA-only guide transport for GitHub Actions.
 * No public provider credentials, user data, programme listings or
 * service-role API keys are committed or returned without GitHub OIDC.
 */
const AUD="loungetv-international-epg-qa";
const REPO="Gazzamoo111/lounge-tv-feed";
const REPO_ID="1382412339";
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
async function authorize(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const pieces=token.split(".");
  if(pieces.length!==3||token.length>12000)return false;
  try{
    const header=JSON.parse(new TextDecoder().decode(decode64url(pieces[0])));
    const claims=JSON.parse(new TextDecoder().decode(decode64url(pieces[1])));
    const now=Math.floor(Date.now()/1000);
    if(header.alg!=="RS256"||typeof header.kid!=="string"||!header.kid)return false;
    if(claims.iss!=="https://token.actions.githubusercontent.com"||claims.aud!==AUD)return false;
    if(String(claims.repository)!==REPO||String(claims.repository_id)!==REPO_ID)return false;
    if(String(claims.ref)!==REF||claims.workflow_ref!==WORKFLOW)return false;
    if(claims.event_name!=="push"||claims.repository_visibility!=="public")return false;
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
Deno.serve(async(req)=>{
  if(!await authorize(req))return fail();
  const url=new URL(req.url);
  const path=url.pathname.split("/").filter(Boolean).slice(-1)[0]||"";
  try{
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
    if(path==="regional-playlist"&&req.method==="GET"){
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
      const type=req.headers.get("content-type")||"";
      const len=Number(req.headers.get("content-length")||0);
      if(type!=="application/gzip"||len<1||len>49000000||!req.body)
        return json({error:"compressed_xmltv_required"},400);
      const target=privateStorage("POST");
      const resp=await fetch(target,{
        method:"POST",
        headers:{...storageHeaders(),"Content-Type":"application/gzip",
          "Cache-Control":"max-age=600","x-upsert":"true"},
        body:req.body,
        signal:AbortSignal.timeout(100000)
      });
      if(!resp.ok)return json({error:"storage_upload_failed",status:resp.status},502);
      return json({stored:true,status:resp.status});
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
