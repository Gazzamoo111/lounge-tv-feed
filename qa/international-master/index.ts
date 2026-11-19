import { nzSourceForBinding, nzPlaylistLines } from "./nz-routing.mjs";
import { qaEpgAlias } from "./qa-epg-alias.mjs";
import { nuvioChannelPriority } from "./channel-priority.mjs";
import { nuvio247Group } from "./qa-247-groups.mjs";
import { nuvioStreamingGroup } from "./qa-stream-groups.mjs";
import { qaAuVisibleRows } from "./qa-au-duplicates.mjs";
import { qaAuWrongGuide } from "./qa-au-integrity.mjs";
import { qaSkySwapPrimary } from "./qa-sky-fhd-primary.mjs";
import { qaSkyOriginalHdBackups } from "./qa-sky-hd-backups.mjs";
import { qaSkyNzLoopFilter } from "./qa-sky-nz-loop-filter.mjs";
import { qaCustomerLiveRows, qaCustomerCategoryLabels } from "./qa-customer-live-presentation.mjs";
import { qaTvnzXtreamDrmFields } from "./qa-tvnz-xtream-drm.mjs";
import { masterVisibleOrder, masterSeaGroups, masterSeaGroup, masterRegionGroup, masterCategoryLabels } from "./qa-international-architecture.mjs";
import postgres from "npm:postgres@3.4.7";

// LOUNGE_SUPAVISOR_TRANSACTION_POOL
const rawDbUrl=Deno.env.get("SUPABASE_DB_URL");
if(!rawDbUrl) throw new Error("SUPABASE_DB_URL missing");
function transactionPoolUrl(raw:string){
  const u=new URL(raw);
  const parts=u.hostname.split(".");
  const ref=parts.length>1?parts[1]:"liqocisegeqzbyuqloql";
  u.hostname="aws-0-ap-southeast-2.pooler.supabase.com";
  u.port="5432";
  u.username="postgres."+ref;
  return u.toString();
}
const dbUrl=transactionPoolUrl(rawDbUrl);
const sql=postgres(dbUrl,{prepare:false,max:1,idle_timeout:5,connect_timeout:10});

const JSON_HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"};
const xmlEsc=(s:unknown)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const slug=(s:unknown)=>String(s??"").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"other";
const epoch=(v:unknown)=>{ if(!v)return null; const n=new Date(String(v)).getTime(); return Number.isFinite(n)?Math.floor(n/1000):null; };
const b64=(s:unknown)=>btoa(unescape(encodeURIComponent(String(s??""))));

const BEST_BASE=(Deno.env.get("LOUNGE_BEST_BASE")||"http://line.loungeconnect247.xyz").replace(/\/+$/,"");
const RECOVERY_MODE=false;
const SPORT_BACKEND_CATEGORY_IDS=new Set([
  "2202","1118","2243","1334","2436","1596","1612","2336","2424","1532","2495","1523","1521","860",
  "1960","675","401","677","678","1309","676","680","2213","2540","2270","2170","2219","804","1661",
  "2223","1900","1367","1999","2178","2187","2420","384","1621","1007","2426","2425","2076","1916",
  "2186","1571","1592","1857","1124","2511","2224","1631","668","2022","1606","1308","1753","2332",
  "2528","1751","2401","1658","2183","2496","2232","2261","1528","1655","1580","1527","2541","1073",
  "614","1117","1566","1570","1568","1504","1503","1581","2214","1795","1307","1211","622","1863",
  "1165","2222","2175","1346","1347"
]);
async function sportsProviderStreamAllowed(providerItemId:number){
  if(!Number.isFinite(providerItemId)||providerItemId<=0) return false;
  const rows=await sql`
    select 1
    from lounge_sync.best_inventory_items
    where kind='live' and is_present=true
      and provider_item_id=${providerItemId}
      and (
        category_id=any(${Array.from(SPORT_BACKEND_CATEGORY_IDS)}::text[])
        or name ~* '(sport|nba|nfl|nhl|mlb|ncaa|rugby|league|cricket|football|soccer|ufc|boxing|ppv|dazn|espn|sky sport|stan sport|premier sport|bein|tnt sport|fox sport)'
      )
    limit 1
  `;
  return rows.length===1;
}
async function bestBase(){ return BEST_BASE; }
function credentials(url:URL,pathParts:string[]){
  const u=url.searchParams.get("username")||pathParts[1]||"";
  const p=url.searchParams.get("password")||pathParts[2]||"";
  return {u,p};
}
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});}
function categoryId(prefix:string,name:string){return prefix+"_"+slug(name);}

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"https://liqocisegeqzbyuqloql.supabase.co";
const LIVE_M3U_URL=SUPABASE_URL+"/functions/v1/lounge-core-live-m3u";
const LIVE_XMLTV_URL=SUPABASE_URL+"/functions/v1/lounge-core-live-xmltv";
const accountCache=new Map<string,{until:number,ok:boolean,payload:any}>();
const accountInflight=new Map<string,Promise<{ok:boolean,payload:any}>>();
const vodEntitlementCache=new Map<string,{until:number,ids:Set<number>}>();
const vodEntitlementInflight=new Map<string,Promise<Set<number>|null>>();
const catalogueCache=new Map<string,{until:number,rows:any[]}>();
const catalogueInflight=new Map<string,Promise<any[]>>();
let movieProbeCredsCache:{until:number,base:string,username:string,password:string}|null=null;

async function movieProbeCredentials(){
  if(movieProbeCredsCache&&movieProbeCredsCache.until>Date.now()) return movieProbeCredsCache;
  const rows=await sql`
    select decrypted_secret::jsonb as c
    from vault.decrypted_secrets
    where name='lounge_best_xtream_catalogue_credentials'
    limit 1
  `;
  const c:any=rows[0]?.c;
  if(!c?.username||!c?.password) return null;
  const out={
    until:Date.now()+10*60*1000,
    base:String(c.server_url||BEST_BASE).replace(/\/+$/,""),
    username:String(c.username),
    password:String(c.password)
  };
  movieProbeCredsCache=out;
  return out;
}

async function runtimeProbeMovieSource(source:any){
  const creds=await movieProbeCredentials();
  if(!creds)return false;
  const ext=String(source.file_ext||"mp4").replace(/[^a-z0-9]/gi,"")||"mp4";
  const target=creds.base+"/movie/"+encodeURIComponent(creds.username)+"/"+encodeURIComponent(creds.password)+"/"+Number(source.provider_item_id)+"."+ext;
  let ok=false;
  let status:number|null=null;
  try{
    const r=await fetch(target,{
      headers:{Range:"bytes=0-65535",Accept:"*/*","User-Agent":"LoungeTV-VOD-Probe/1.0"},
      signal:AbortSignal.timeout(7000)
    });
    status=r.status;
    if(r.status===200||r.status===206){
      const reader=r.body?.getReader();
      if(reader){
        const first=await reader.read();
        ok=(first.value?.byteLength||0)>0;
        try{await reader.cancel();}catch{}
      }
    }
  }catch{}
  const health=ok?"good":(status===404||status===410?"dead":"degraded");
  await sql`
    update lounge_core.sources
    set runtime_health=${health},
        runtime_verified=${ok},
        last_runtime_verified_at=now(),
        updated_at=now()
    where id=${String(source.source_id)}::uuid
  `;
  return ok;
}
async function shareCatalogue(key:string,load:()=>Promise<any[]>){
  const existing=catalogueInflight.get(key);
  if(existing) return await existing;
  const task=load();
  catalogueInflight.set(key,task);
  try{return await task;}finally{catalogueInflight.delete(key);}
}

async function customerVodIds(base:string,u:string,p:string,action:"get_vod_streams"|"get_series"){
  const key=u+"::"+p+"::"+action;
  const hit=vodEntitlementCache.get(key);
  if(hit&&hit.until>Date.now()) return hit.ids;
  const existing=vodEntitlementInflight.get(key);
  if(existing) return await existing;

  const task=(async()=>{
    if(vodEntitlementCache.size>50){
      for(const [k,v] of vodEntitlementCache){
        if(v.until<=Date.now()) vodEntitlementCache.delete(k);
      }
    }

    const q=new URL(base+"/player_api.php");
    q.searchParams.set("username",u);
    q.searchParams.set("password",p);
    q.searchParams.set("action",action);
    try{
      const r=await fetch(q,{
        headers:{Accept:"application/json","User-Agent":"LoungeTV-Gateway/1.0"},
        signal:AbortSignal.timeout(30000),
      });
      const payload=await r.json().catch(()=>null);
      if(!r.ok||!Array.isArray(payload)) return null;
      const ids=new Set<number>();
      const field=action==="get_series"?"series_id":"stream_id";
      for(const row of payload){
        const id=Number(row?.[field]);
        if(Number.isFinite(id)&&id>0) ids.add(id);
      }
      vodEntitlementCache.set(key,{until:Date.now()+1800000,ids});
      return ids;
    }catch{
      return null;
    }
  })();

  vodEntitlementInflight.set(key,task);
  try{return await task;}finally{vodEntitlementInflight.delete(key);}
}
async function providerSeriesIdForEpisode(episodeId:number){
  const rows=await sql`
    select es.provider_series_item_id
    from lounge_core.episode_sources es
    join public.providers p on p.id=es.provider_id
    where p.name='BEST'
      and es.provider_episode_id=${String(episodeId)}
      and es.status in ('verified','candidate','degraded')
    limit 1
  `;
  const id=Number(rows[0]?.provider_series_item_id);
  return Number.isFinite(id)&&id>0?id:null;
}
type CanonLive={key:string;name:string;group:string;logo:string;epgId:string;chno:number;url:string;streamId:number;providerId:number|null};
const liveCache=new Map<string,{until:number,rows:CanonLive[]}>();
const liveInflight=new Map<string,Promise<CanonLive[]>>();
function liveAttr(line:string,name:string){const marker=name+'="';const i=line.indexOf(marker);if(i<0)return "";const j=line.indexOf('"',i+marker.length);return j<0?"":line.slice(i+marker.length,j);}
function liveHash(s:string){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}
function providerIdFromLiveUrl(raw:string){
  if(!raw.includes("lounge-core-xtream/live/"))return null;
  try{const u=new URL(raw);const parts=u.pathname.split("/").filter(Boolean);const last=parts[parts.length-1]||"";const n=Number(last.split(".")[0]);return Number.isFinite(n)?n:null;}catch{return null;}
}
function parseCanonicalM3u(body:string){
  const out:CanonLive[]=[];let pending:any=null;
  for(const raw of body.split("\n")){const line=raw.replace("\r","").trim();if(!line)continue;
    if(line.startsWith("#EXTINF:")){const comma=line.indexOf(",");pending={key:liveAttr(line,"channel-id")||liveAttr(line,"tvg-id"),epgId:liveAttr(line,"tvg-id"),logo:liveAttr(line,"tvg-logo"),group:liveAttr(line,"group-title")||"Live TV",chno:Number(liveAttr(line,"tvg-chno")||0),name:comma>=0?line.slice(comma+1).trim():"Channel"};continue;}
    if(line.startsWith("#"))continue;
    if(pending){const pid=providerIdFromLiveUrl(line);const key=String(pending.key||pending.epgId||pending.name);out.push({key,name:String(pending.name),group:String(pending.group),logo:String(pending.logo||""),epgId:String(pending.epgId||""),chno:Number(pending.chno||out.length+1),url:line,streamId:pid??(1500000000+(liveHash(key+"|"+line)%400000000)),providerId:pid});pending=null;}
  }
  return out.sort((a,b)=>(a.chno||999999)-(b.chno||999999));
}
async function canonicalLive(u:string,p:string){
  const k=u+"::"+p;const hit=liveCache.get(k);if(hit&&hit.until>Date.now())return hit.rows;
  const existing=liveInflight.get(k);if(existing)return await existing;
  const task=(async()=>{
    const q=new URL(LIVE_M3U_URL);q.searchParams.set("username",u);q.searchParams.set("password",p);
    const r=await fetch(q,{headers:{Accept:"application/x-mpegURL,text/plain,*/*","User-Agent":"LoungeTV-Gateway/1.0"},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error("LIVE_CATALOGUE_HTTP_"+r.status);
    const rows=parseCanonicalM3u(await r.text());
    liveCache.set(k,{until:Date.now()+600000,rows});
    return rows;
  })();
  liveInflight.set(k,task);
  try{return await task;}finally{liveInflight.delete(k);}
}

async function legacyCredentialHash(u:string,p:string){
  const raw=u.trim().toLowerCase()+"\u0000"+p;
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function cachedLegacyAccount(u:string,p:string){
  if(!u||!p)return false;
  const hash=await legacyCredentialHash(u,p);
  const rows=await sql`
    select 1
    from lounge_delivery.legacy_xtream_auth_cache
    where credential_hash=${hash}
      and valid_until>now()
    limit 1
  `;
  return rows.length>0;
}
async function rememberLegacyAccount(u:string,p:string){
  const hash=await legacyCredentialHash(u,p);
  await sql`
    insert into lounge_delivery.legacy_xtream_auth_cache(credential_hash,valid_until,last_verified_at)
    values(${hash},now()+interval '6 hours',now())
    on conflict (credential_hash)
    do update set valid_until=excluded.valid_until,last_verified_at=excluded.last_verified_at
  `;
}
async function catalogueAccountState(base:string,u:string,p:string){
  if(!u||!p)return {ok:false,payload:null};
  if(await cachedLegacyAccount(u,p))return {ok:true,payload:null};
  return await accountState(base,u,p);
}

async function accountState(base:string,u:string,p:string){
  if(!u||!p) return {ok:false,payload:null};
  const key=u+"::"+p;
  const hit=accountCache.get(key);
  if(hit&&hit.until>Date.now()) return {ok:hit.ok,payload:hit.payload};

  const existing=accountInflight.get(key);
  if(existing) return await existing;

  const task=(async()=>{
    const q=new URL(base+"/player_api.php");
    q.searchParams.set("username",u);
    q.searchParams.set("password",p);

    let lastPayload:any=null;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const r=await fetch(q,{
          headers:{Accept:"application/json","User-Agent":"LoungeTV-Gateway/1.0"},
          signal:AbortSignal.timeout(20000),
        });
        const payload=await r.json().catch(()=>null);
        lastPayload=payload;

        const active=Boolean(
          r.ok&&payload?.user_info&&(
            Number(payload.user_info.auth)===1||
            String(payload.user_info.status||"").toLowerCase()==="active"
          )
        );
        if(active){
          accountCache.set(key,{until:Date.now()+300000,ok:true,payload});
          try{await rememberLegacyAccount(u,p);}catch(e){console.error("LEGACY_AUTH_CACHE_WRITE",String(e));}
          return {ok:true,payload};
        }

        const explicitInvalid=Boolean(
          r.ok&&payload?.user_info&&(
            Number(payload.user_info.auth)===0||
            ["disabled","expired","banned"].includes(String(payload.user_info.status||"").toLowerCase())
          )
        );
        if(explicitInvalid){
          accountCache.set(key,{until:Date.now()+15000,ok:false,payload});
          return {ok:false,payload};
        }
      }catch{}

      if(attempt<2) await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
    }

    // Never poison the shared cache on transient provider/network failures.
    return {ok:false,payload:lastPayload};
  })();

  accountInflight.set(key,task);
  try{return await task;}
  finally{accountInflight.delete(key);}
}

const providerCategoryCache=new Map<string,{until:number,rows:any[]}>();

async function providerCategoryRows(base:string,u:string,p:string,action:"get_live_categories"|"get_vod_categories"|"get_series_categories"){
  const key=u+"::"+p+"::"+action;
  const hit=providerCategoryCache.get(key);
  if(hit&&hit.until>Date.now()) return hit.rows;
  const q=new URL(base+"/player_api.php");
  q.searchParams.set("username",u);
  q.searchParams.set("password",p);
  q.searchParams.set("action",action);
  try{
    const r=await fetch(q,{headers:{Accept:"application/json","User-Agent":"LoungeTV-Filter/1.0"},signal:AbortSignal.timeout(20000)});
    const rows=await r.json().catch(()=>null);
    if(!r.ok||!Array.isArray(rows)) return [];
    providerCategoryCache.set(key,{until:Date.now()+600000,rows});
    return rows;
  }catch{return [];}
}

const NON_ENGLISH=/\b(arab|arabic|turk|turkish|french|france|spanish|latino|latin\b|german|deutsch|italian|italy|portugu|brazil|dutch|netherland|polish|poland|greek|romanian|albanian|russian|ukrain|serbian|croatian|bosnian|bulgarian|hungarian|czech|slovak|sloven|swedish|sweden|norweg|danish|denmark|finnish|finland|iceland|hebrew|israel|persian|farsi|urdu|hindi|bollywood|punjabi|tamil|telugu|malayalam|bengali|pakistan|india\b|korean|korea|japanese|japan|chinese|china|mandarin|cantonese|thai|vietnam|indonesia|malaysia|filipino|african|africa)\b/i;
const JUNK_VOD=/\b(adult|xxx|18\+|cam\b|hdcam|camrip|telesync|\bts\b|hdts|screener|workprint|subbed|dubbed)\b/i;

// Recovery allowlist: customer-facing Lounge categories only.
// Event banks are included only where Lounge needs them, then filtered again per stream.
const LIVE_ALLOWED_CATEGORY_IDS=new Set([
  "1007","2401","1606",
  "672","667","666","680","1346",
  "521","905","520","401","2213","1309","1900",
  "1593","1623","1532",
  "2436","2232","1521","2170","1596","2496","2224","1631",
  "2076","676","1751","677","2420","1960","675","804",
  "1568","2270","2222","1753","2176","2202","1118","860",
  "2528","1523","1592","1655","1621","1571","1857","1612",
  "614","668",
  "765","2290","2291","2292","2293","2294"
]);

const STATIC_LIVE_GROUPS:Record<string,number[]>={"Sports • NZ/AU":[6213945,1147630,6236046],"Australia • Sports":[857795,857796,857798,857801,857799,857800,857802,857803,857804],"New Zealand • Sports":[3904954,3904955,3904956,4876690,3904958,3904959,3904960,3904961,3904962,3904952,3904953],"Sports • UK & International":[106,2274,2275,2276,2277,2278,5598469,2398,2194009,2391,818515,2307,1916314,1916315,2309,3795822,2279,1293,5598515,5598457,2301,6299845,744657,744658,5598467,1849779,1918716,1918705,1918722,1918547,1918743,1918734,1918552,1918727,2368,1962515,1962517,1962519,1962605,744635,34298,2381,2382,891471],"Australia • TV":[857758,954194,954195,954196,954197,857768,857824,889562,954193,857788,857790,857791],"Entertainment • UK":[744578,1322905,1322902,1322900,1322903,744626,1523195,1322892,744570,744581,744580,744602,744614,890278,925087,744599,744620,744618,744690,744691,744624,744693,891051,744616,890245,744577,1917471,744627,892432,892430,892428,5294849,744621,890232,744694,744572,744582,744573,744583,3550044,1259300,890227,890567,744700,744697,1359968,1359969,890266,744630,744631,890250,744632,744597,744596,744680,744683,744617,744695,744696,744682,1359966,744699,3550042,892426,1359967,744598,890568,890569,890566,744633,892421,3550046,892447,1359961,744606,1359962,744600,1208240,1359964,1359963],"Entertainment • US":[740748,740749,1571215,740744,34153,34154,34156,34159,737459,3170147,4646403,4646404],"Movies":[591,582,609,614,4297064,4297063,4297065,584,585,586,587,744605,34254,576,2309107,579,577,583,34220,34222,34221,621,625,623,588,593,595,592,594,596,601,603,599,602,600,744669,1983392,744670,744671,744678,744673,744675,744676,744679,1359965,744677,642,626,628,630,633,635,637,638,639,640,644,634,627,641,265,606],"Entertainment":[105,1282,108,109,110,116,122,127,126,128,135,141,145,148,150,149,151,158,160,168,169,170,172,178,181,180,187,194,673677,673678,476312,201,202,203,572,212,211,218,227,233,234,235,237,256,258,259,262,4850054,5598478,277,4850053,281,290,292,294],"Kids & Family • Kids":[3550059,6053260,744579,744571,1359970,1359971,1359975,3550047,3550049,1269,3550061,1359972,891112,1359974,3550057,3550055,891117,891119,870457,3550058,891121,1281],"Entertainment • FAST":[1148131,1148135,1148136,1148142,1148147,1148160,1148165,1148169,1148173,1148174,1148176,1148180,1148182,1148185,1148189,1148190,1148191,1148196,1148199,1148203,1148204,1148207,1148210,1148212,1148221,1148231,1148232,1148234,1148237,1148238,1148240,1133213,1133216,1133217,1133218,1133220,1133221,1133227,1133230,1133231,1133232,1133233,1133235,1133239,1133241,1133243,1133244,1133247,1133250,1133252,1133253,1133258,1133259,1133261,1133266,1133267,1133269,1133270,1133271,1133272,1133274,1133278,1133285,1133290,1133291,1133295,1133301,1133303,1133304,1133309,1133343,1133346,1133354,1133356,1133357,1133360,1133362,1133363,1133364,1133365,1133369,1133374,1133378,1133373,1133380,1133382,1133383,1133384,1133389,1133391,1133395,1133396,1133398,1133402,1133403,1133413,1133415,1133420,1133424,1133427,1133428,1133439,1133443,1133444,1133446,1133448,1133449,1133462,1133463,1133468,1133475,1133485,1133487,1133492,1133493,1133494,1133499,1133501,1133503,1133510,1133513,1133516,1133517,1133545,1133547,1133556,1133563,1133569,1133570,1133590,1133593,1133604,1133613,1133628,1133629,1133631,1133632,1133636,1133638,1133641,1133649,1133666,1133670,1133671,1133672,1133676,1133680,1133681,1133690,1133691,1133692,1133695,1133697,1133699,1133700,1133702,1133704,1133709,1133712,1133713,1133496,1133719,1133722,1133724,1133727,1133735,1133736,1133741,1133742,1133744,1133746,1133747,1133749,1133751,1133752,1133760,1133764,1133770,1133773,1133774,1133783,1133787,1133795,1133804,1133808,1133809,1133813,1133816,1133817,1133822,1133824,1133825,1133827,1714125,1291968,1291970,1291971,1291973,1291975,1291981,1291988,1291990,1291995,1291996,1292000,1292001,1292003,1292007,1292008,1292009,1292017,1292019,1292021,1292022,1292033,1292034,1292036,1292039,1292040,1292049,1292051,1292053,1292054,1292055,1292056,1292063,1292064,1292074,1292080,1292082,1292083,1292085,1292094,1292095,1292099,1292102,1292104,1292105,1292108,1292109,1292112,1292115,1292118,1292119],"24/7 • Animation & Anime":[1714783,1708181,1713950,1708199,3453718,1715216,1715217,1745624],"24/7 • Classics & Nostalgia":[1745069,1714966,1713996,1713998,1714002,1715142,1714051,1714960,1715235,1713842,1713922,1745061,1713951,1713954,1745073,1745080,1714958,1745091,1745095,1714028,1714037,1714059,1745127,1714926,1745132,1745134,1715062,1714923,1714090,1715113,1745140,1714105,1714106,1714115,3453782],"24/7 • Comedy & Sitcoms":[1745409,1715149,1715219,1714045,1745687,1745473,1714014,1745533,1613344,1715138,1745648,1714927,1745690,1745707,1714118],"24/7 • Crime & Drama":[1714103,1714122,1745744,1708182,1708184,1713925,1708185,1713928,1713999,1745770,1714022,1714023,3453721,1708209,1745789,1745791,1708219,1715170,1708223,1715152,3458428,1708241,1708251,1708252,1708255,1715167,1715126],"24/7 • Factual & Documentary":[1714785,1713907,1714950,3458412,1744892],"24/7 • Kids, Animation & Anime":[1745872,1714038,1713934,1713942,1714031,1714042,1613436,1613410,1715240,1714101,1745030,1708271,1745842,1708165,1713871,1613406,1613444,1745851,1613423,1721351,1714949,1745857,1745858,1713936,1721360,1745923,1714786,1721381,1744973,1714030,1708222,1133568,1714921,1745901,1613408,1745905,1721397,1745912,1714060,1714063,1613416,1133650,1745920,1714075,1721412,1721413,1708264,1714109],"24/7 • Movies & Franchises":[1714989,1715065,1714993,1714858,1715078,1744979,1715205,1714935,1715092,1715021,1714951,1714871,1714801,1708190,1715212,1714889,1714855,1715097,1715208,1714895,1715037,1714939,1613382,1613391,1613389,1715201,1715199,1715003,1715093,1714902,1714798,1715007,1715193,1714896,1745128,1715014,1715016,1715102,1714093,1715090,1715054,1714864],"24/7 • Reality & Lifestyle":[1713931,1745235,1745249,1745254,1745181,1745400,1713958,1713961,1745211,1745090,1745246,1745285],"24/7 • Series & Drama":[1715109,1745368,1713924,3453705,1715107,1744962,3453715,1715099,3453719,1715143,1714847,1708212,1715031,1714936,1613424,1613449,1714868,1745590,1715134,1708233,1714074,3453745,3453758,1708257,1708281,1745310,1745164,1744774,3453695,1714781,1721352,1714917,1714952,1714857,1708187,1713945,1715046,1713960,1708192,1713965,1715162,1714780,1713977,1714965,1745079,1713994,1745768,1708197,1745471,1744793,3458403,1714005,1745087,1744812,1721380,1744815,1715081,1714009,1714011,1744970,1708201,1745216,1708202,1708204,1714024,1715080,1745500,1715047,3453722,1708205,3458406,1745223,1745097,1745787,1714920,1714850,1745105,3458409,3458410,3453725,3453726,1714041,3458411,1715048,1708218,1714044,1744857,1714046,1715027,1715034,1715106,1715029,1715038,1715032,1714050,1613386,1613394,1613352,1613438,1613425,1613353,1613432,1613447,1613415,1714058,1744868,3458419,1715012,1744880,1708235,1744894,1715079,1714073,1708238,1714077,3453742,1708240,1708243,3453749,1708246,3453751,1708248,1708249,3453752,1714084,1745677,3453754,1721408,1745691,1714089,1714957,1708262,3453770,1708269,3453775,1714796,1714794,1714792,3453778,1708277,1714789,1714116,1745149,1708280,1714120],"Documentaries & Lifestyle • US - News Network":[45438,91936,1453860,1920416,1920415,91952,91953,1454385,1920387,91784,91783,45593,91782,442785,2151804,45575,45573,150355,2151627,2151637,91942,1932190,2004245,45455,1795752],"Documentaries & Lifestyle • US - Documentaries":[1920434,2151787,2151771,1920183,1920182,1920181,1920082],"Kids & Family • Movies":[924719,924720,924721,924722,924723,924724,924725,924726,924727,924728,924729,924730]};
const STATIC_LIVE_ID_GROUP=new Map<number,string>();
for(const [g,ids] of Object.entries(STATIC_LIVE_GROUPS)) for(const id of ids) STATIC_LIVE_ID_GROUP.set(Number(id),g);
function cleanCategoryName(v:unknown){return String(v??"").replace(/\s+/g," ").trim();}

function liveCategoryAllowedRow(row:any){
  const id=String(row?.category_id??"");
  const name=cleanCategoryName(row?.category_name);
  return LIVE_ALLOWED_CATEGORY_IDS.has(id) && liveCategoryAllowed(name);
}

function liveCategoryAllowed(nameRaw:unknown){
  const name=cleanCategoryName(nameRaw);
  if(!name||NON_ENGLISH.test(name)) return false;
  if(/\b(adult|xxx|religio|church|shopping|radio|music only)\b/i.test(name)) return false;
  if(/\b(local stations?|locals?)\b/i.test(name)&&!/\bNZ\b|new zealand/i.test(name)) return false;
  return (
    /(^|\W)(NZ|NEW ZEALAND)(\W|$)/i.test(name) ||
    /\bsky sport/i.test(name) ||
    /\bnow tv\b/i.test(name) ||
    /\b(sport|sports|espn|tnt|bein)\b/i.test(name) ||
    /\b(nfl|nba|wnba|mlb|nhl)\b/i.test(name) ||
    /\b(peacock|paramount\+|stan)\b/i.test(name) ||
    /\b(rugby|nrl|super league)\b/i.test(name) ||
    /\b(ufc|boxing|fite|combat)\b/i.test(name) ||
    /\b(kids|cartoon|disney|nick|cbeebies|cartoonito|baby)\b/i.test(name) ||
    /\b(news|business|weather)\b/i.test(name) ||
    /\b(documentar|lifestyle|history|science|nature)\b/i.test(name) ||
    /\b(entertainment|movie network|premium movie|cinema)\b/i.test(name) ||
    /24\/7/i.test(name) ||
    /\b(ppv|event)\b/i.test(name)
  );
}

function vodCategoryAllowed(nameRaw:unknown,type:"movie"|"series"){
  const name=cleanCategoryName(nameRaw);
  if(!name||NON_ENGLISH.test(name)||JUNK_VOD.test(name)) return false;
  if(/\b(adult|xxx|religio|karaoke|music video)\b/i.test(name)) return false;
  const premium=/\b(netflix|disney|pixar|marvel|dc\b|hbo|max\b|apple|prime|amazon|hulu|paramount|peacock|showtime|starz|dreamworks|illumination|universal|warner|sony|lionsgate|a24)\b/i.test(name);
  const genre=/\b(action|adventure|animation|comedy|crime|documentar|drama|family|kids|mystery|reality|romance|sci[\s-]?fi|fantasy|thriller|horror|western|biography|history|sport)\b/i.test(name);
  const english=/\b(en\b|english|usa|us\b|uk\b|australia|au\b|new zealand|nz\b)\b/i.test(name);
  const fresh=/\b(new release|latest|recent|2026|2025|sky store|premiere|featured|trending)\b/i.test(name);
  const generic=type==="movie"?/\b(movie|movies|film|films|cinema)\b/i.test(name):/\b(series|tv show|shows)\b/i.test(name);
  return premium||genre||english||fresh||generic;
}

function itemName(v:any){return String(v?.name??v?.title??"").replace(/\s+/g," ").trim();}
function vodItemAllowed(v:any){
  const n=itemName(v);
  if(!n||JUNK_VOD.test(n)) return false;
  if(/\b(2160p cam|cam 2160p|korsub|hc sub|hardcoded sub)\b/i.test(n)) return false;
  return true;
}

function nzLiveAllowed(nameRaw:unknown,categoryRaw:unknown){
  const cat=cleanCategoryName(categoryRaw);
  if(!/(^|\W)(NZ|NEW ZEALAND)(\W|$)/i.test(cat)) return true;
  const n=itemName({name:nameRaw});
  if(/\b(bbc earth|eden|juice tv|parliament tv|rush|sky open)\b/i.test(n)) return false;
  if(/\bsky sport\b/i.test(n)) return /\b(raw|hd|sky sport\s*(?:[1-9]|pop up))\b/i.test(n);
  return /\b(tvnz\s*1|tvnz\s*2|three|whakaata|te reo|bravo|hgtv|duke)\b/i.test(n);
}


function dynamicLivePublicOk(v:any,categoryName:string){
  const name=itemName(v);
  const upper=name.toUpperCase().replace(/\s+/g," ").trim();
  const cat=String(categoryName||"").toUpperCase();

  // Keep permanent network channels. Apply the slot gate only to event/package banks.
  const dynamic=/\b(PPV|PACKAGE|EVENT|ESPN PLAY|PEACOCK|PARAMOUNT\+|STAN|NBA|NFL|NHL|MLB|WNBA|RUGBY|SUPER LEAGUE|UFC|BOXING|FITE|TENNIS|MLS)\b/.test(cat);
  if(!dynamic) return true;

  if(/\b(NO EVENT|OFFLINE|NOT ACTIVE|NOT AVAILABLE|PLACEHOLDER|TBA)\b/.test(upper)) return false;

  const generic=[
    /^NBA\s*\d+\s*:?\s*$/i,
    /^WNBA\s*\d+\s*:?\s*$/i,
    /^NFL\s*\d+\s*:?\s*$/i,
    /^NHL\s*\d+\s*:?\s*$/i,
    /^MLB\s*\d+\s*:?\s*$/i,
    /^MILB\s*\d+\s*:?\s*$/i,
    /^NCAAF?\s*\d+\s*:?\s*$/i,
    /^UFC\s*\d+\s*:?\s*$/i,
    /^US\s*\(PEACOCK\s+\d+\)\s*$/i,
    /^US\s*\(PARAMOUNT\+?\s+\d+\)\s*$/i,
    /^:PARAMOUNT\+\s+\d+\s*$/i,
    /^:MAX US\s+\d+\s*$/i,
    /^AU\s*\(STAN\s+\d+\)\s*$/i,
    /^\(AU\)\s*ESPN PLAY\s+\d+(?:\s*\(D\))?\s*$/i,
    /^UK:\s*SKY SPORTS\+\s*EVENT\s+\d+\s*$/i,
    /^SKY SPORTS\+\s*EVENT\s+\d+\s*$/i,
    /^ESPN PLAY\s+\d+\s*$/i,
    /^PEACOCK\s+\d+\s*$/i,
    /^PARAMOUNT\+\s+\d+\s*$/i,
    /^STAN\s+\d+\s*$/i,
    /^PPV\s+\d+\s*$/i,
    /^EVENT\s+\d+\s*$/i
  ];
  if(generic.some(r=>r.test(upper))) return false;

  // Numbered event-bank labels are noise unless the provider has replaced
  // the slot name with a real fixture/event description.
  const looksNumbered=/\b(PLAY|EVENT|PPV|STAN|PEACOCK|PARAMOUNT|MAX|DAZN|ESPN|SKY SPORTS\+)\b.*\d+\s*$/i.test(upper);
  const semantic=/\b(VS| V |@|ROUND|DAY|RACE|MATCH|FINAL|SEMI|RUGBY|NRL|NFL|NBA|NHL|MLB|UFC|BOXING|TENNIS|ATP|WTA|CRICKET|FOOTBALL|SOCCER|LEAGUE|CUP|CHAMPIONSHIP)\b/i.test(upper);
  if(looksNumbered&&!semantic) return false;

  return true;
}

function liveItemAllowed(v:any,categoryName:string){
  const n=itemName(v);
  if(!n||!nzLiveAllowed(n,categoryName)) return false;
  if(!dynamicLivePublicOk(v,categoryName)) return false;
  if(/\b(no event|offline|test channel|placeholder)\b/i.test(n)) return false;
  if(/24\/7/i.test(categoryName)&&/\bsimpsons\b/i.test(n)&&!/4k/i.test(n)) return false;
  if(/\b(replay highlights?)\b/i.test(n)&&/\b(ppv|event|sport)\b/i.test(categoryName)) return false;
  return true;
}

function liveQualityRank(nameRaw:unknown){
  const n=String(nameRaw??"").toLowerCase();
  if(/4k|uhd/.test(n)) return 0;
  if(/fhd|1080p/.test(n)) return 1;
  if(/\bhd\b|720p/.test(n)) return 2;
  if(/\bsd\b/.test(n)) return 4;
  return 3;
}

function liveDedupeKey(v:any,categoryName:string){
  let n=itemName(v).toLowerCase()
    .replace(/^(us|uk|au|nz)\s*[|:-]\s*/i,"")
    .replace(/\b(4k|uhd|fhd|1080p(?:60|50|30)?|720p(?:60|50|30)?|hd|sd)\b/ig,"")
    .replace(/\s+/g," ").trim();
  if(/\braw\b/i.test(itemName(v))) n+="|raw";
  else if(/\bhd\b/i.test(itemName(v))) n+="|hd";
  return cleanCategoryName(categoryName).toLowerCase()+"|"+n;
}

function dedupeLive(rows:any[],catMap:Map<string,string>){
  const best=new Map<string,any>();
  for(const row of rows){
    const cat=catMap.get(String(row?.category_id??""))||"";
    const key=liveDedupeKey(row,cat);
    const prev=best.get(key);
    if(!prev||liveQualityRank(row?.name)<liveQualityRank(prev?.name)) best.set(key,row);
  }
  return [...best.values()];
}


const STATIC_DYNAMIC_GROUPS:Record<string,string>={
  "1593":"Pay-Per-View • Rugby League","1623":"Pay-Per-View • Stan Sport","2436":"Pay-Per-View • Football",
  "2232":"Pay-Per-View • ESPN / Max","1521":"Pay-Per-View • DAZN","1596":"Pay-Per-View • Paramount+",
  "2496":"Pay-Per-View • Paramount+","2224":"Pay-Per-View • Paramount+","1631":"Pay-Per-View • Peacock",
  "676":"Pay-Per-View • NBA","1751":"Pay-Per-View • WNBA","677":"Pay-Per-View • NHL",
  "675":"Pay-Per-View • NFL","804":"Pay-Per-View • MLB","1568":"Pay-Per-View • Combat",
  "2270":"Pay-Per-View • Football","2222":"Pay-Per-View • Football","2176":"Pay-Per-View • Tennis",
  "2202":"Pay-Per-View • ESPN+","2528":"Pay-Per-View • Premier League","1523":"Pay-Per-View • DAZN",
  "1592":"Pay-Per-View • Combat","1655":"Pay-Per-View • Rugby League","1621":"Pay-Per-View • Rugby",
  "1571":"Pay-Per-View • UK Sports Extra","1857":"Pay-Per-View • UK Sports Extra","1612":"Pay-Per-View • ESPN+",
  "614":"Pay-Per-View • UK PPV Events","668":"Pay-Per-View • Live Events"
};
function staticProviderGroup(row:any){
  const id=Number(row?.stream_id);
  const fixed=STATIC_LIVE_ID_GROUP.get(id);
  if(fixed) return fixed;
  const cid=String(row?.category_id??"");
  const name=itemName(row);
  if(cid==="2401"&&/\bSKY SPORT\s*(?:[1-9]|POP UP)\b/i.test(name)) return "New Zealand • Sports";
  if(cid==="2213") return "Entertainment • UK Now TV";
  const dynamic=STATIC_DYNAMIC_GROUPS[cid];
  if(dynamic&&dynamicLivePublicOk(row,dynamic)) return dynamic;
  return "";
}
function staticLiveDedupeName(nameRaw:unknown){
  return String(nameRaw??"").toLowerCase()
    .replace(/^(us|uk|au|nz)[\s|:-]+/i,"")
    .replace(/\b(4k|uhd|fhd|1080p(?:60|50|30)?|720p(?:60|50|30)?|hd|sd)\b/ig,"")
    .replace(/\s+/g," ").trim();
}
async function staticProviderLiveRows(base:string,u:string,p:string){
  const q=new URL(base+"/player_api.php");
  q.searchParams.set("username",u);q.searchParams.set("password",p);q.searchParams.set("action","get_live_streams");
  try{
    const r=await fetch(q,{headers:{Accept:"application/json","User-Agent":"LoungeTV-StaticCatalogue/1.0"},signal:AbortSignal.timeout(30000)});
    const payload=await r.json().catch(()=>null);
    if(!r.ok||!Array.isArray(payload)) return null;
    const best=new Map<string,any>();
    for(const row of payload){
      const group=staticProviderGroup(row);
      if(!group) continue;
      const name=itemName(row);
      if(!name) continue;
      const key=group+"|"+staticLiveDedupeName(name);
      const prev=best.get(key);
      if(!prev||liveQualityRank(name)<liveQualityRank(itemName(prev))) best.set(key,{...row,__lounge_group:group});
    }
    const out=[...best.values()];
    console.log("LOUNGE_STATIC_LIVE","provider",payload.length,"curated",out.length);
    return out;
  }catch(err){
    console.error("LOUNGE_STATIC_LIVE_FAILED",err);
    return null;
  }
}
async function staticFallbackApi(base:string,u:string,p:string,url:URL,action:string){
  if(action==="get_live_categories"||action==="get_live_streams"){
    const rows=await staticProviderLiveRows(base,u,p);
    if(!rows) return json({error:"catalogue_unavailable"},503);
    if(action==="get_live_categories"){
      const seen=new Set<string>(),out:any[]=[];
      for(const r of rows){
        const g=String(r.__lounge_group||"");
        const id=categoryId("live",g);
        if(g&&!seen.has(id)){seen.add(id);out.push({category_id:id,category_name:g});}
      }
      return json(out);
    }
    const wanted=url.searchParams.get("category_id");
    const visible=rows.filter((r:any)=>!wanted||categoryId("live",String(r.__lounge_group))===wanted);
    return json(visible.map((r:any,i:number)=>({
      num:i+1,name:itemName(r),stream_type:"live",stream_id:Number(r.stream_id),
      stream_icon:r.stream_icon||"",epg_channel_id:r.epg_channel_id||"",added:String(r.added||"0"),
      category_id:categoryId("live",String(r.__lounge_group)),custom_sid:"",tv_archive:0,direct_source:"",tv_archive_duration:0
    })));
  }
  if(action==="get_short_epg") return json([]);
  return json({error:"canonical_catalogue_unavailable"},503);
}
async function filterProviderPayload(base:string,u:string,p:string,action:string,payload:any){
  if(!Array.isArray(payload)) return payload;
  if(action==="get_live_categories") return payload.filter((x:any)=>liveCategoryAllowedRow(x));
  if(action==="get_vod_categories") return payload.filter((x:any)=>vodCategoryAllowed(x?.category_name,"movie"));
  if(action==="get_series_categories") return payload.filter((x:any)=>vodCategoryAllowed(x?.category_name,"series"));

  let categoryAction:"get_live_categories"|"get_vod_categories"|"get_series_categories"|null=null;
  let kind:"live"|"movie"|"series"|null=null;
  if(action==="get_live_streams"){categoryAction="get_live_categories";kind="live";}
  else if(action==="get_vod_streams"){categoryAction="get_vod_categories";kind="movie";}
  else if(action==="get_series"){categoryAction="get_series_categories";kind="series";}
  if(!categoryAction||!kind) return payload;

  const cats=await providerCategoryRows(base,u,p,categoryAction);
  const catMap=new Map<string,string>(cats.map((x:any)=>[String(x?.category_id??""),cleanCategoryName(x?.category_name)]));
  const allowedIds=new Set<string>(cats.filter((x:any)=>kind==="live"?liveCategoryAllowedRow(x):vodCategoryAllowed(x?.category_name,kind)).map((x:any)=>String(x?.category_id??"")));
  let out=payload.filter((x:any)=>allowedIds.has(String(x?.category_id??"")));
  if(kind==="live"){
    out=out.filter((x:any)=>liveItemAllowed(x,catMap.get(String(x?.category_id??""))||""));
    out=dedupeLive(out,catMap);
  }else{
    out=out.filter(vodItemAllowed);
  }
  console.log("LOUNGE_FILTER_RESULT",action,"raw",payload.length,"filtered",out.length);
  return out;
}

async function providerApiRelay(base:string,u:string,p:string,requestUrl:URL){
  const q=new URL(base+"/player_api.php");
  for(const [k,v] of requestUrl.searchParams){
    if(k!=="_lounge_host") q.searchParams.append(k,v);
  }
  q.searchParams.set("username",u);
  q.searchParams.set("password",p);
  try{
    const r=await fetch(q,{
      headers:{Accept:"application/json","User-Agent":"LoungeTV-Recovery/1.0"},
      signal:AbortSignal.timeout(30000)
    });
    const rawBody=await r.text();
    let body=rawBody;
    try{
      const action=requestUrl.searchParams.get("action")||"account";
      const payload=JSON.parse(rawBody);
      const filtered=await filterProviderPayload(base,u,p,action,payload);
      body=JSON.stringify(filtered);
      if(["get_live_categories","get_vod_categories","get_series_categories"].includes(action)&&Array.isArray(filtered)){
        console.log("LOUNGE_PROVIDER_CATEGORIES",action,JSON.stringify(filtered.slice(0,250).map((x:any)=>({id:String(x?.category_id??""),name:String(x?.category_name??"")}))));
      }
    }catch(err){console.error("LOUNGE_FILTER_ERROR",err);}
    return new Response(body,{
      status:r.status,
      headers:{
        "Content-Type":"application/json; charset=utf-8",
        "Cache-Control":"private, max-age=30",
        "Access-Control-Allow-Origin":"*",
        "X-Lounge-Mode":"provider-recovery"
      }
    });
  }catch{
    return json({error:"provider_unavailable"},502);
  }
}

async function providerM3u(base:string,u:string,p:string){
  const q=new URL(base+"/get.php");
  q.searchParams.set("username",u);
  q.searchParams.set("password",p);
  q.searchParams.set("type","m3u_plus");
  q.searchParams.set("output","ts");
  try{
    const r=await fetch(q,{
      headers:{Accept:"application/x-mpegURL,text/plain,*/*","User-Agent":"LoungeTV-Recovery/1.0"},
      signal:AbortSignal.timeout(30000)
    });
    return new Response(await r.text(),{
      status:r.status,
      headers:{
        "Content-Type":"application/x-mpegURL; charset=utf-8",
        "Cache-Control":"private, max-age=30",
        "Access-Control-Allow-Origin":"*",
        "X-Lounge-Mode":"provider-recovery"
      }
    });
  }catch{
    return new Response("#EXTM3U\n",{status:502,headers:{"Content-Type":"application/x-mpegURL; charset=utf-8"}});
  }
}

async function providerXmltv(base:string,u:string,p:string){
  const q=new URL(base+"/xmltv.php");
  q.searchParams.set("username",u);
  q.searchParams.set("password",p);
  try{
    const r=await fetch(q,{
      headers:{Accept:"application/xml,text/xml,*/*","User-Agent":"LoungeTV-Recovery/1.0"},
      signal:AbortSignal.timeout(30000)
    });
    return new Response(await r.text(),{
      status:r.status,
      headers:{
        "Content-Type":"application/xml; charset=utf-8",
        "Cache-Control":"public, max-age=120",
        "Access-Control-Allow-Origin":"*",
        "X-Lounge-Mode":"provider-recovery"
      }
    });
  }catch{
    return new Response("<?xml version=\"1.0\"?><tv></tv>",{status:502,headers:{"Content-Type":"application/xml; charset=utf-8"}});
  }
}

async function accountRelay(base:string,u:string,p:string,requestUrl:URL){
  const state=await accountState(base,u,p);
  if(!state.ok) return json({user_info:{auth:0,status:"Disabled"}},401);
  const payload=state.payload&&typeof state.payload==="object"?structuredClone(state.payload):{};
  const now=Math.floor(Date.now()/1000);
  payload.server_info={
    url:(requestUrl.hostname.endsWith(".supabase.co") ? (requestUrl.searchParams.get("_lounge_host") || requestUrl.hostname) : requestUrl.hostname),
    port:"443",
    https_port:"443",
    server_protocol:"https",
    timezone:"Pacific/Auckland",
    timestamp_now:now,
    time_now:new Date(now*1000).toISOString(),
    process:true
  };
  return json(payload);
}
async function liveRows(u:string,p:string){
  const rows=await canonicalLive(u,p);
  return rows.map((e:any)=>({display_name:e.name,category:e.group,epg_id:e.epgId,logo_url:e.logo,release_order:e.chno,provider_stream_id:e.streamId,provider_id:e.providerId,target_url:e.url}));
}
async function liveTarget(u:string,p:string,id:number){const rows=await canonicalLive(u,p);return rows.find((e:any)=>e.streamId===id)||null;}
async function vodRows(type:"movie"|"series"){
  const cacheKey="vod:"+type;
  const hit=catalogueCache.get(cacheKey);
  if(hit&&hit.until>Date.now()) return hit.rows;
  return await shareCatalogue(cacheKey,async()=>{
    const secondHit=catalogueCache.get(cacheKey);
    if(secondHit&&secondHit.until>Date.now()) return secondHit.rows;
    const rows=await sql`
    select t.id,t.tmdb_id,t.canonical_title,t.release_year,t.release_date,t.overview,t.poster_url,
           t.metadata,t.updated_at,
           s.provider_item_id,s.file_ext,
           g.name genre_name,g.slug genre_slug
    from lounge_core.titles t
    join lateral (
      select s.provider_item_id,s.file_ext
      from lounge_core.sources s
      join public.providers p on p.id=s.provider_id
      where s.title_id=t.id
        and p.name='BEST'
        and s.status in ('verified','candidate','degraded')
      order by
        case s.source_role when 'primary' then 0 when 'backup' then 1 else 2 end,
        case s.status when 'verified' then 0 when 'candidate' then 1 else 2 end,
        s.runtime_verified desc,s.quality_score desc,s.provider_item_id
      limit 1
    ) s on true
    left join lateral (
      select
        case
          when ${type}::text='series' and g.name in ('Action','Adventure','Action & Adventure') then 'Action & Adventure'
          when ${type}::text='series' and g.name in ('Science Fiction','Fantasy','Sci-Fi & Fantasy') then 'Sci-Fi & Fantasy'
          else g.name
        end as name,
        case
          when ${type}::text='series' and g.name in ('Action','Adventure','Action & Adventure') then 'action-adventure'
          when ${type}::text='series' and g.name in ('Science Fiction','Fantasy','Sci-Fi & Fantasy') then 'sci-fi-fantasy'
          else g.slug
        end as slug
      from lounge_core.title_genres tg
      join lounge_core.genres g on g.id=tg.genre_id
      where tg.title_id=t.id
        and (
          ${type}::text<>'series'
          or g.name in (
            'Action','Adventure','Action & Adventure','Animation','Comedy','Crime','Documentary',
            'Drama','Family','Kids','Mystery','Reality','Science Fiction','Fantasy','Sci-Fi & Fantasy'
          )
        )
      order by
        case
          when ${type}::text<>'series' then 999
          when g.name in ('Action & Adventure','Action','Adventure') then 10
          when g.name='Animation' then 20
          when g.name='Comedy' then 30
          when g.name='Crime' then 40
          when g.name='Documentary' then 50
          when g.name='Drama' then 60
          when g.name='Family' then 70
          when g.name='Kids' then 80
          when g.name='Mystery' then 90
          when g.name='Reality' then 100
          when g.name in ('Sci-Fi & Fantasy','Science Fiction','Fantasy') then 110
          else 999
        end,
        g.name
      limit 1
    ) g on true
    where t.content_type=${type}
      and t.status<>'excluded'
      and t.editorial_status<>'rejected'
      and (
        ${type}::text <> 'movie'
        or exists (
          select 1
          from lounge_core.vod_taxonomy_members vm
          where vm.title_id=t.id
        )
      )
    order by t.release_date desc nulls last,t.canonical_title
  `;
    catalogueCache.set(cacheKey,{until:Date.now()+600000,rows});
    return rows;
  });
}
async function categoriesFor(type:"movie"|"series"){
  if(type==="movie"){
    const cacheKey="categories:movie";
    const hit=catalogueCache.get(cacheKey);
    if(hit&&hit.until>Date.now()) return hit.rows;
    const rows=await sql`select category_key,display_name from lounge_core.vod_taxonomy_categories where enabled and category_type='genre' order by sort_order,display_name`;
    const out=[{category_id:"movie_all",category_name:"All Movies"},...rows.map((r:any)=>({category_id:"movie_"+String(r.category_key),category_name:String(r.display_name)}))];
    catalogueCache.set(cacheKey,{until:Date.now()+600000,rows:out});
    return out;
  }
  return [
    {category_id:"series_all",category_name:"All Series"},
    {category_id:"series_action-adventure",category_name:"Action & Adventure"},
    {category_id:"series_animation",category_name:"Animation"},
    {category_id:"series_comedy",category_name:"Comedy"},
    {category_id:"series_crime",category_name:"Crime"},
    {category_id:"series_documentary",category_name:"Documentary"},
    {category_id:"series_drama",category_name:"Drama"},
    {category_id:"series_family",category_name:"Family"},
    {category_id:"series_kids",category_name:"Kids"},
    {category_id:"series_mystery",category_name:"Mystery"},
    {category_id:"series_reality",category_name:"Reality"},
    {category_id:"series_sci-fi-fantasy",category_name:"Sci-Fi & Fantasy"}
  ];
}
async function movieRows(wanted:string|null){
  const key=wanted&&wanted!=="movie_all"&&wanted.startsWith("movie_")?wanted.slice(6):null;
  const cacheKey="movie:"+(key||"all");
  const hit=catalogueCache.get(cacheKey);
  if(hit&&hit.until>Date.now()) return hit.rows;
  return await shareCatalogue(cacheKey,async()=>{
    const secondHit=catalogueCache.get(cacheKey);
    if(secondHit&&secondHit.until>Date.now()) return secondHit.rows;
    const rows=await sql`
    select t.id,t.tmdb_id,t.canonical_title,t.release_year,t.release_date,t.overview,t.poster_url,t.backdrop_url,
           t.metadata,t.updated_at,s.provider_item_id,s.file_ext,
           cat.category_key,cat.display_name as category_name
    from lounge_core.titles t
    join lateral (
      select s.provider_item_id,s.file_ext
      from lounge_core.sources s join public.providers p on p.id=s.provider_id
      where s.title_id=t.id and p.name='BEST' and s.provider_kind='movies' and s.status in ('verified','candidate','degraded')
      order by case s.source_role when 'primary' then 0 when 'backup' then 1 else 2 end,
               case s.status when 'verified' then 0 when 'candidate' then 1 else 2 end,
               s.runtime_verified desc,s.quality_score desc,s.provider_item_id limit 1
    ) s on true
    left join lateral (
      select tc.category_key,tc.display_name
      from lounge_core.vod_taxonomy_members vm
      join lounge_core.vod_taxonomy_categories tc on tc.category_key=vm.category_key
      where vm.title_id=t.id and tc.enabled and tc.category_type='genre'
      order by tc.sort_order,vm.rank desc limit 1
    ) cat on true
    where t.content_type='movie' and t.status<>'excluded' and t.editorial_status<>'rejected'
      and exists(select 1 from lounge_core.vod_taxonomy_members vm where vm.title_id=t.id)
      and (${key}::text is null or exists(
        select 1 from lounge_core.vod_taxonomy_members vm2 join lounge_core.vod_taxonomy_categories tc2 on tc2.category_key=vm2.category_key
        where vm2.title_id=t.id and tc2.enabled and tc2.category_key=${key}
      ))
    order by t.release_date desc nulls last,t.canonical_title
  `;
    catalogueCache.set(cacheKey,{until:Date.now()+600000,rows});
    return rows;
  });
}
async function movieInfo(vodId:string){
  const rows=await sql`
    select t.id,t.tmdb_id,t.canonical_title,t.release_year,t.release_date,t.overview,t.poster_url,t.backdrop_url,t.runtime_minutes,t.metadata,
           s.provider_item_id,s.file_ext
    from lounge_core.titles t
    join lounge_core.sources s on s.title_id=t.id join public.providers p on p.id=s.provider_id
    where t.content_type='movie' and p.name='BEST' and s.provider_kind='movies' and s.provider_item_id=${Number(vodId)}
      and s.status in ('verified','candidate','degraded') and t.status<>'excluded' and t.editorial_status<>'rejected'
    order by case s.source_role when 'primary' then 0 when 'backup' then 1 else 2 end limit 1
  `;
  if(!rows.length)return {};
  const r:any=rows[0],m=r.metadata||{};
  const genres=await sql`select g.name from lounge_core.title_genres tg join lounge_core.genres g on g.id=tg.genre_id where tg.title_id=${String(r.id)}::uuid order by g.name`;
  const cast=Array.isArray(m.cast)?m.cast.map((x:any)=>x?.name).filter(Boolean).slice(0,15).join(", "):"";
  const backs=Array.isArray(m?.artwork?.backdrops)?m.artwork.backdrops.slice(0,3).map((x:any)=>x?.url).filter(Boolean):(r.backdrop_url?[r.backdrop_url]:[]);
  return {
    info:{tmdb_id:r.tmdb_id,name:r.canonical_title,original_name:r.canonical_title,movie_image:r.poster_url||"",plot:r.overview||"",description:r.overview||"",
      releasedate:r.release_date||"",year:r.release_year||null,genre:genres.map((x:any)=>x.name).join(", "),cast,rating:Number(m.vote_average||0),
      duration_secs:r.runtime_minutes?Number(r.runtime_minutes)*60:0,backdrop_path:backs},
    movie_data:{stream_id:Number(r.provider_item_id),name:r.canonical_title,container_extension:r.file_ext||"mp4",custom_sid:null,direct_source:""}
  };
}
async function seriesInfo(seriesId:string){
  const t=await sql`
    select t.id,t.canonical_title,t.overview,t.poster_url,t.backdrop_url,t.release_date,t.release_year,t.metadata
    from lounge_core.titles t join lounge_core.sources s on s.title_id=t.id join public.providers p on p.id=s.provider_id
    where t.content_type='series' and p.name='BEST' and s.provider_item_id=${Number(seriesId)}
      and s.status in ('verified','candidate','degraded') and t.status<>'excluded' and t.editorial_status<>'rejected'
    order by case s.source_role when 'primary' then 0 when 'backup' then 1 else 2 end limit 1
  `;
  if(!t.length)return {};
  const title:any=t[0],m=title.metadata||{};
  const rows=await sql`
    select se.season_number,se.title as season_title,se.poster_url as season_poster,
           e.episode_number,e.title,e.overview,e.release_date,e.still_url,es.provider_episode_id,es.file_ext
    from lounge_core.seasons se join lounge_core.episodes e on e.season_id=se.id and e.status<>'excluded'
    join lateral (
      select es.provider_episode_id,es.file_ext from lounge_core.episode_sources es
      where es.episode_id=e.id and es.status in ('verified','degraded','candidate')
      order by case es.status when 'verified' then 0 when 'candidate' then 1 else 2 end,es.runtime_verified desc,es.quality_score desc limit 1
    ) es on true
    where se.series_title_id=${String(title.id)}::uuid order by se.season_number,e.episode_number
  `;
  const episodes:Record<string,unknown[]>={};const seasons=new Map<number,any>();
  for(const r of rows){
    const n=Number(r.season_number),k=String(n);
    if(!seasons.has(n))seasons.set(n,{air_date:null,episode_count:0,id:n,name:r.season_title||("Season "+n),overview:"",season_number:n,cover:r.season_poster||""});
    const season=seasons.get(n);season.episode_count++;
    (episodes[k]??=[]).push({id:String(r.provider_episode_id),episode_num:Number(r.episode_number),title:String(r.title||""),container_extension:r.file_ext||"mkv",season:n,
      release_date:r.release_date?new Date(r.release_date).toISOString().slice(0,10):null,info:{plot:r.overview||"",movie_image:r.still_url||""}});
  }
  const cast=Array.isArray(m.cast)?m.cast.map((x:any)=>x?.name).filter(Boolean).slice(0,15).join(", "):"";
  return {
    info:{name:title.canonical_title,cover:title.poster_url||"",plot:title.overview||"",cast,rating:Number(m.vote_average||0),
      releaseDate:title.release_date||"",year:title.release_year||null,backdrop_path:Array.isArray(m?.artwork?.backdrops)?m.artwork.backdrops.slice(0,3).map((x:any)=>x?.url).filter(Boolean):[]},
    seasons:[...seasons.values()].sort((a:any,b:any)=>a.season_number-b.season_number),episodes
  };
}
async function shortEpgEntry(entry:CanonLive|undefined,limit:number){
  if(!entry)return {epg_listings:[]};
  let ch:any[]=[];
  if(entry.providerId!=null){
    ch=await sql`select c.id from lounge_core.live_sources s join lounge_core.live_channels c on c.id=s.live_channel_id
      where s.provider_stream_id=${entry.providerId} and c.status in ('staging','approved','placeholder') limit 1`;
  }
  if(!ch.length&&entry.epgId){
    ch=await sql`select id from lounge_core.live_channels where epg_id=${entry.epgId} or canonical_key=${entry.key} limit 1`;
  }
  if(!ch.length)return {epg_listings:[]};
  const rows=await sql`select id,start_at,end_at,title,description,has_archive from lounge_core.live_epg_programmes
    where live_channel_id=${String(ch[0].id)}::uuid and end_at>now()-interval '1 hour' order by start_at limit ${limit}`;
  return {epg_listings:rows.map((r:any)=>({id:String(r.id),title:b64(r.title),description:b64(r.description||""),
    start_timestamp:String(Math.floor(new Date(r.start_at).getTime()/1000)),stop_timestamp:String(Math.floor(new Date(r.end_at).getTime()/1000)),has_archive:r.has_archive?1:0}))};
}
async function customerM3u(u:string,p:string,url:URL){
  const authBase=await bestBase();
  const auth=await accountState(authBase,u,p);
  if(!auth.ok) return json({error:"not_allowed"},403);
  const q=new URL(LIVE_M3U_URL);
  q.searchParams.set("username",u);
  q.searchParams.set("password",p);
  try{
    const r=await fetch(q,{headers:{Accept:"application/x-mpegURL,text/plain,*/*","User-Agent":"LoungeTV-Gateway/1.0"},signal:AbortSignal.timeout(30000)});
    if(!r.ok) return new Response("#EXTM3U\n",{status:r.status,headers:{"Content-Type":"application/x-mpegURL; charset=utf-8","Cache-Control":"no-store"}});
    let body=await r.text();
    const forwardedHost=url.searchParams.get("_lounge_host")||"";
    if(forwardedHost){
      const internal=SUPABASE_URL+"/functions/v1/lounge-core-xtream";
      const external="https://"+forwardedHost;
      body=body.split(internal).join(external);
    }
    return new Response(body,{status:200,headers:{"Content-Type":"application/x-mpegURL; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"}});
  }catch{
    return new Response("#EXTM3U\n",{status:502,headers:{"Content-Type":"application/x-mpegURL; charset=utf-8","Cache-Control":"no-store"}});
  }
}

async function xmltv(){
  try{
    const r=await fetch(LIVE_XMLTV_URL,{headers:{Accept:"application/xml,text/xml,*/*","User-Agent":"LoungeTV-Gateway/1.0"},signal:AbortSignal.timeout(30000)});
    return new Response(r.body,{status:r.status,headers:{"Content-Type":"application/xml; charset=utf-8","Cache-Control":"public, max-age=120","Access-Control-Allow-Origin":"*"}});
  }catch{return new Response("<?xml version=\"1.0\"?><tv></tv>",{status:502,headers:{"Content-Type":"application/xml; charset=utf-8"}});}
}

type ReleaseRow={id:string;release_key:string};
let activeReleaseCache:{until:number,row:ReleaseRow|null}|null=null;
async function activeRelease():Promise<ReleaseRow|null>{
  if(activeReleaseCache&&activeReleaseCache.until>Date.now()) return activeReleaseCache.row;
  const rows=await sql`
    select id::text,release_key
    from lounge_delivery.catalogue_releases
    where state='active'
    order by activated_at desc nulls last
    limit 1
  `;
  const row=rows.length?{id:String(rows[0].id),release_key:String(rows[0].release_key)}:null;
  activeReleaseCache={until:Date.now()+30000,row};
  return row;
}
function loungeAndroidRequest(req:Request){
  return (req.headers.get("user-agent")||"").toLowerCase().includes("loungetv/android");
}
function loungeLivePresentationId(category:unknown,subcategory:unknown){
  const raw=String(category||"")+"\u001f"+String(subcategory||"");
  let h=2166136261;
  for(let i=0;i<raw.length;i++){
    h^=raw.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return String(1000000000+((h>>>0)%900000000));
}
function loungeLivePresentationName(category:unknown,subcategory:unknown){
  const top=String(category||"").trim();
  const sub=String(subcategory||"").trim();
  if(!sub||sub.toLowerCase()===top.toLowerCase()) return top||"Live TV";
  return top+" · "+sub;
}

const LOUNGE_SHORT_EPG_BASE="https://raw.githubusercontent.com/Gazzamoo111/lounge-tv-player/epg-data/epg/short";
const shortEpgCache=new Map<string,{until:number,list:any[]}>();
function shortEpgFileKey(raw:string){
  let h=2166136261;
  const bytes=new TextEncoder().encode(raw);
  for(const b of bytes){h^=b;h=Math.imul(h,16777619);}
  return (h>>>0).toString(16).padStart(8,"0");
}
function effectiveLiveEpgId(row:any){
  // Ten is not 10 Bold. Do not display another network’s programmes.
  if(qaAuWrongGuide(row))return "";
  const supplied=String(row?.epg_id||"").trim();
  if(supplied)return supplied;
  const name=String(row?.display_name||"").trim().toUpperCase().replace(/\s+/g," ");
  const sky=name.match(/^SKY SPORT ([1-9])$/);
  if(sky)return "SkySport"+sky[1]+".nz";
  if(name==="SKY SPORT SELECT")return "SkySportSelect.nz";
  if(name==="SKY NZ ESPN")return "ESPN.nz";
  if(name==="SKY NZ ESPN 2")return "ESPN2.nz";
  return String(row?.canonical_key||"").trim();
}
async function staticShortEpg(epgId:string,limit:number,externalId:number){
  if(!epgId)return null;
  const key=shortEpgFileKey(epgId);
  let list:any[]|null=null;
  const hit=shortEpgCache.get(key);
  if(hit&&hit.until>Date.now()) list=hit.list;
  if(!list){
    try{
      // One shared database guide serves every customer. Retain the existing
      // published-file fallback if a database import is missing or unavailable.
      try{
        const stored=await sql`select listings from lounge_delivery.shared_epg_channels
          where epg_id=${epgId} and expires_at>now() and synced_at>now()-interval '24 hours'`;
        const entries=stored[0]?.listings;
        if(Array.isArray(entries)&&entries.some((x:any)=>Number(x.stop_timestamp)>Date.now()/1000)){
          list=entries;
          shortEpgCache.set(key,{until:Date.now()+5*60*1000,list:entries});
        }
      }catch{ /* Existing shared files remain available during database recovery. */ }
      if(!list){
      const r=await fetch(LOUNGE_SHORT_EPG_BASE+"/"+key+".json",{
        headers:{Accept:"application/json","User-Agent":"LoungeTV-EPG-Short/1.0"},
        signal:AbortSignal.timeout(8000)
      });
      if(!r.ok)return null;
      const body=await r.json().catch(()=>null);
      list=Array.isArray(body?.epg_listings)?body.epg_listings:[];
      shortEpgCache.set(key,{until:Date.now()+10*60*1000,list:list||[]});
      }
    }catch{return null;}
  }
  if(!list)return null;
  const now=Math.floor(Date.now()/1000);
  return list
    .filter((x:any)=>Number(x.stop_timestamp||0)>=now-900)
    .slice(0,limit)
    .map((x:any)=>({
      ...x,
      channel_id:"ltv-"+externalId,
      epg_id:externalId,
      now_playing:Number(x.start_timestamp||0)<=now&&Number(x.stop_timestamp||0)>now?1:0,
      has_archive:0,
    }));
}

let xmltvShortCache:{until:number,body:string}|null=null;
const SKY_CINEMA_SIDS:Record<string,string>={
  "SkyCinemaAction.uk":"4014",
  "SkyAction.uk":"4014",
  "SkyCinemaGreats.uk":"4015",
  "SkyCinemaDrama.uk":"4016",
  "SkyCinemaSciFiHorror.uk":"4017",
  "SkyCinemaFamily.uk":"4018",
  "SkyCinemaComedy.uk":"4019",
  "SkyCinemaSelect.uk":"4020",
  "SkyCinemaPremiere.uk":"4021",
  "SkyPremiere.uk":"4021",
  "SkyCinemaHits.uk":"4033",
  "SkyCinemaThriller.uk":"4062",
  "SkyThriller.uk":"4062",
};
function skyShortDate(offset:number){
  const d=new Date(Date.now()+offset*86400000);
  const z=(n:number)=>String(n).padStart(2,"0");
  return `${d.getUTCFullYear()}${z(d.getUTCMonth()+1)}${z(d.getUTCDate())}`;
}
async function skyCinemaShortEpg(epgId:string,limit:number,externalId:number){
  const sid=SKY_CINEMA_SIDS[epgId];
  if(!sid)return [];
  const dates=[skyShortDate(0),skyShortDate(1),skyShortDate(2)];
  const payloads=await Promise.all(dates.map(async(date)=>{
    try{
      const r=await fetch(`https://awk.epgsky.com/hawk/linear/schedule/${date}/${sid}`,{
        headers:{
          "X-SkyOTT-Territory":"GB",
          "Accept":"application/json",
          "User-Agent":"LoungeTV-Xtream-SkyEPG/1.0",
        },
        signal:AbortSignal.timeout(8000),
      });
      if(!r.ok)return null;
      return await r.json().catch(()=>null);
    }catch{return null;}
  }));
  const now=Math.floor(Date.now()/1000);
  const seen=new Set<string>();
  const events:any[]=[];
  for(const payload of payloads){
    if(!Array.isArray(payload?.schedule))continue;
    for(const sched of payload.schedule){
      if(String(sched?.sid)!==sid||!Array.isArray(sched?.events))continue;
      for(const e of sched.events){
        const st=Number(e?.st),dur=Number(e?.d);
        if(!Number.isFinite(st)||!Number.isFinite(dur)||dur<=0||!e?.t)continue;
        if(st+dur<now-900)continue;
        const key=String(e?.eid||"")+""+String(st);
        if(seen.has(key))continue;
        seen.add(key);
        events.push(e);
      }
    }
  }
  events.sort((a:any,b:any)=>Number(a.st)-Number(b.st));
  return events.slice(0,limit).map((e:any)=>{
    const startTs=Number(e.st),stopTs=startTs+Number(e.d);
    return {
      id:String(e.eid||`${epgId}:${startTs}`),
      epg_id:externalId,
      title:b64(String(e.t||"")),
      lang:"",
      start:new Date(startTs*1000).toISOString().replace("T"," ").replace(".000Z",""),
      end:new Date(stopTs*1000).toISOString().replace("T"," ").replace(".000Z",""),
      description:b64(String(e.sy||"")),
      channel_id:"ltv-"+externalId,
      start_timestamp:startTs,
      stop_timestamp:stopTs,
      now_playing:startTs<=now&&stopTs>now?1:0,
      has_archive:0,
    };
  });
}

function xmlText(raw:string){
  return raw
    .replace(/<[^>]+>/g," ")
    .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'")
    .replace(/&#39;/g,"'").replace(/&#x27;/gi,"'")
    .replace(/\s+/g," ").trim();
}
function xmltvEpoch(raw:string){
  const m=String(raw||"").trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if(!m)return 0;
  let ms=Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6]));
  if(m[7]){
    const offset=(Number(m[8])*60+Number(m[9]))*60000;
    ms+=m[7]==="+"?-offset:offset;
  }
  return Math.floor(ms/1000);
}
async function xmltvShortEpg(epgId:string,limit:number,externalId:number){
  if(!epgId)return [];
  let body="";
  if(xmltvShortCache&&xmltvShortCache.until>Date.now()){
    body=xmltvShortCache.body;
  }else{
    try{
      const r=await fetch(LIVE_XMLTV_URL,{
        headers:{Accept:"application/xml,text/xml,*/*","User-Agent":"LoungeTV-EPG-Short-Fallback/1.0"},
        signal:AbortSignal.timeout(30000)
      });
      if(!r.ok)return [];
      body=await r.text();
      xmltvShortCache={until:Date.now()+10*60*1000,body};
    }catch{return [];}
  }
  const safe=epgId.replace(/[.*+?^$()|[\]{}\\]/g,"\\$&");
  const rx=new RegExp(`<programme\\b(?=[^>]*\\bchannel=["']${safe}["'])[^>]*>[\\s\\S]*?<\\/programme>`,"gi");
  const now=Math.floor(Date.now()/1000);
  const rows:any[]=[];
  let m:RegExpExecArray|null;
  while((m=rx.exec(body))!==null){
    const block=m[0];
    const tag=block.slice(0,block.indexOf(">")+1);
    const startRaw=tag.match(/\bstart=["']([^"']+)["']/i)?.[1]||"";
    const stopRaw=tag.match(/\bstop=["']([^"']+)["']/i)?.[1]||"";
    const startTs=xmltvEpoch(startRaw),stopTs=xmltvEpoch(stopRaw);
    if(!startTs||!stopTs||stopTs<now-900)continue;
    const title=xmlText(block.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1]||"");
    if(!title)continue;
    const desc=xmlText(block.match(/<desc(?:\s[^>]*)?>([\s\S]*?)<\/desc>/i)?.[1]||"");
    rows.push({
      id:null,epg_id:externalId,title:b64(title),lang:"en",
      start:new Date(startTs*1000).toISOString(),end:new Date(stopTs*1000).toISOString(),
      description:b64(desc),channel_id:"ltv-"+externalId,
      start_timestamp:startTs,stop_timestamp:stopTs,
      now_playing:startTs<=now&&stopTs>now?1:0,has_archive:0
    });
  }
  rows.sort((a:any,b:any)=>Number(a.start_timestamp)-Number(b.start_timestamp));
  return rows.slice(0,limit);
}

/* Nuvio full BEST live inventory - QA only. This overlay never mutates the active release. */
// Single coherent QA-only catalogue architecture; NZ/AU production untouched.
const INTERNATIONAL_QA_GROUPS=masterSeaGroups;
const NUVIO_GROUPS=masterVisibleOrder;
const NUVIO_VISIBLE_ORDER=masterVisibleOrder;
const NUVIO_STREAM_BASE=2000000000;
function nuvioGroupId(g:string){const n=NUVIO_GROUPS.indexOf(g);return String(1800101+(n<0?NUVIO_GROUPS.indexOf("International TV"):n));}
function nuvioGood(r:any):boolean{
 const n=String(r.name||"").trim(),c=String(r.provider_group||"").trim();
 if(!n||r.is_adult===true)return false;
 if(/^(?:\s*#{3,}|\s*[-=*]{5,}|\s*\[HEADER\])/i.test(n))return false;
 if(/NO EVENT STREAMING|NO SIGNAL|OFF AIR|COMING SOON|TEST PATTERN|CHANNEL NOT FOUND/i.test(n))return false;
 if(/(?:^|\W)(?:XXX|ADULT|18\+)(?:\W|$)/i.test(c))return false;
 if(/(?:^|\W)(?:RADIO|PODCAST|AUDIO ONLY)(?:\W|$)/i.test(c))return false;
 return true;
}
function nuvioClean(n:string){return n.replace(/^\s*[A-Z]{2,5}\s*\|\s*/i,"").trim().replace(/\s+/g," ");}
function nuvioIdentity(n:string){return nuvioClean(n).normalize("NFKC").replace(/[ᴿᴬᵂ⁶⁰ᶠᵖˢᴴᴰ]/g,"").replace(/\b(?:SD|HD|FHD|HEVC|UHD|4K|720P|1080P)\b/gi,"").replace(/[^\p{L}\p{N}]+/gu," ").trim().toLowerCase();}
function nuvioGroup(r:any):string{
 const t=String(r.category||"").toLowerCase(),v=String(r.subcategory||"").toUpperCase();
 if(t==="intl-qa")return masterSeaGroup(String(r.subcategory||""))||"International TV";
 const g247=nuvio247Group(t,v);
 if(g247)return g247;
 const gstream=nuvioStreamingGroup(t,v,String(r.display_name||""));
 if(gstream)return gstream;
 if(t==="raw"){
  if(/PPV|ESPN\+|ESPN PLUS|ESPN PLAY|PACKAGE|FLO NETWORK|NCAA|RED BUTTON|TENNIS CHANNEL PLUS/.test(v))return "PPV Source Overflow";
  if(/EVENT|REPLAY|WORLD LIVE SPORTS|CHAMPIONSHIP|FA PLAYER|LEAGUE ONE|LEAGUE TWO|NATIONAL LEAGUE|SKY SPORT\+|CUP GAMES|UEFA/.test(v))return "Live Events";
  // Retain international national programming inside its provider-supplied region.
  // Keep the proven NZ/AU/UK/US topical grouping and priority unchanged.
  const internationalRegion=masterRegionGroup(String(r.subcategory||""));
  if(internationalRegion && !["New Zealand","Australia","UK TV","US TV"].includes(internationalRegion))return internationalRegion;
  if(/SPORT|RUGBY|CRICKET|FORMULA 1|MOTOGP|GOLF|TENNIS|DAZN|EUROSPORT|NBA NETWORK|NFL NETWORK/.test(v))return "Sports Networks";
  if(/NEWS/.test(v))return "News";
  if(/DOCUMENT|SKYMIX DOCS|LIFESTYLE|DISCOVERY|HISTORY|NATURE|SCIENCE/.test(v))return "Documentaries & Lifestyle";
  if(/KIDS|CARTOON|PRESCHOOL/.test(v))return "Kids & Family";
  if(/MUSIC|MTV|VH1|MC VIDEO/.test(v))return "Music";
  if(/MOVIE|CINEMA|SKY STORE|STARZ|HALLMARK/.test(v))return "Movie Channels";
  if(/NETFLIX|DISNEY|HBO MAX|HULU|PRIME|PARAMOUNT|APPLE TV|PEACOCK|TUBI|PLUTO|NOW TV|SKYMIX|BBCIPLAYER|ITV X/.test(v))return "Entertainment & Streaming";
  if(v.startsWith("NZ|")){
    const n=String(r.display_name||"").toUpperCase();
    if(/SPARK SPORTS EVENT/.test(n))return "Live Events";
    if(/NBA TV|MUTV|LFC TV|EDGE SPORTS/.test(n))return "Sports Networks";
    if(/BBC EARTH/.test(n))return "Documentaries & Lifestyle";
    if(/BBC WORLD NEWS|AL JAZEERA|SKY NEWS|^CNN HD/.test(n))return "News";
    return "New Zealand";
  }
  if(v.startsWith("AU|"))return "Australia";
  if(v.startsWith("UK|")||v.startsWith("EN|"))return "UK TV";
  if(v.startsWith("US|"))return "US TV";
  if(v.startsWith("NA|"))return /PPV|EVENT|HOCKEY|SPORT/.test(v)?"PPV Source Overflow":"International TV";
  const region=masterRegionGroup(String(r.subcategory||""));
  if(region)return region;
  return "International TV";
 }
 if(t==="ppv")return "PPV Source Overflow";
 if(t==="sports")return /ppv|event feeds?/.test(v.toLowerCase())?"PPV Source Overflow":/live events?/.test(v.toLowerCase())?"Live Events":"Sports Networks";
 if(t==="new zealand")return "New Zealand";
 if(t==="australia")return "Australia";
 if(t==="entertainment"&&v.startsWith("US"))return "US TV";
 if(t==="entertainment"&&v.startsWith("UK"))return "UK TV";
 if(t==="entertainment"||t==="streaming")return "Entertainment & Streaming";
 if(t==="movies")return "Movie Channels";
 if(t==="documentaries & lifestyle")return "Documentaries & Lifestyle";
 if(t==="kids & family")return "Kids & Family";
 if(t==="music")return "Music";
 return "International TV";
}
async function nuvioFullRows():Promise<any[]>{
 const k="nuvio:international:balanced-selection-v6",cache=catalogueCache.get(k);
 if(cache&&cache.until>Date.now())return cache.rows;
 return await shareCatalogue(k,async()=>{
  const old=catalogueCache.get(k);if(old&&old.until>Date.now())return old.rows;
  // Use the full authenticated BEST trial inventory as the current QA source.
  const [curated,inventory]=await Promise.all([
   releaseLiveRows(null),
   sql`
    SELECT s.provider_stream_id AS provider_item_id,s.original_name AS name,
      s.epg_channel_id,s.artwork_url,false AS is_adult,
      c.provider_category_name AS provider_group
    FROM lounge_sync.international_master_streams_qa_20261119 s
    JOIN lounge_sync.international_master_selection_qa_20261119 chosen
      ON chosen.provider_stream_id=s.provider_stream_id
    JOIN lounge_sync.international_master_categories_qa_20261119 c
      ON c.provider_category_id=s.provider_category_id
    LEFT JOIN lounge_sync.sea_stream_probes_qa_20261119 probe
      ON probe.provider_stream_id=s.provider_stream_id
    LEFT JOIN lounge_delivery.shared_epg_channels guide
      ON guide.epg_id=s.epg_channel_id AND guide.expires_at>now() AND guide.programme_count>0
    WHERE s.provider_stream_id>0
    ORDER BY
      CASE WHEN probe.has_video=true AND probe.http_status IN(200,206) THEN 0 ELSE 1 END,
      CASE WHEN guide.epg_id IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN s.epg_channel_id<>'' THEN 0 ELSE 1 END,
      CASE WHEN s.artwork_url<>'' THEN 0 ELSE 1 END,
      s.provider_stream_id
   `
  ]);
  // Customer NZ Sky Sport 1-9: the curated main must remain FHD. The subsequent
  // QA visibility rule removes unreliable HD duplicates and looping sources.
  const rows:any[]=[...curated.map((r:any)=>qaSkySwapPrimary({...r}))],identities=new Set<string>();
  const used=new Set(rows.filter((r:any)=>r.provider_name==="BEST").map((r:any)=>Number(r.provider_stream_id)));
  for(const row of rows){const group=nuvioGroup(row),n=nuvioIdentity(String(row.display_name));if(group!=="Live Events"&&n)identities.add(group+"|"+n);}
  for(const r of inventory){
   const id=Number(r.provider_item_id);
   if(used.has(id)||id>=147000000||!nuvioGood(r))continue;
   const item:any={external_id:NUVIO_STREAM_BASE+id,provider_stream_id:id,display_name:nuvioClean(String(r.name)),category:"RAW",subcategory:r.provider_group,epg_id:r.epg_channel_id||"",logo_url:r.artwork_url||"",source_format:"ts",provider_name:"BEST",sort_order:999999};
   const group=nuvioGroup(item),n=nuvioIdentity(String(item.display_name)),key=group+"|"+n;
   if(group!=="Live Events"&&n&&identities.has(key))continue;
   if(group!=="Live Events"&&n)identities.add(key);
   rows.push(item);
   used.add(id); // A provider stream ID can only appear once across inventory and SEA QA.
  }
  // SEA add-on removed: full BEST trial inventory is now authoritative.
  // Retain the old NZ HD streams as named manual fallbacks after the FHD trial.
  rows.push(...qaSkyOriginalHdBackups(rows,curated,inventory));
  // Keep curated FHD, hide HD backup rows and looping group. No BEST inventory edit.
  rows.splice(0,rows.length,...qaSkyNzLoopFilter(rows));
  // One customer-facing Australian row per service; raw provider alternatives stay in inventory.
  const auVisible=qaAuVisibleRows(rows,nuvioGroup);
  rows.splice(0,rows.length,...auVisible);
  // Customer-facing NZ TV cleanup. Never alter tested stream IDs or TVNZ DRM.
  rows.splice(0,rows.length,...qaCustomerLiveRows(rows,nuvioGroup));
  // QA v29: strip the provably wrong Ten->10 Bold guide in the customer list.
  for(const row of rows)if(qaAuWrongGuide(row))row.epg_id="";
  // QA EPG recovery: assign only current, verified EPG IDs to exact NZ/AU
  // and selected Sports Networks alternatives. Never guess regional schedules.
  // Rank four customer categories against available programme metadata only:
  // this never edits the source's EPG identity or creates synthetic listings.
  const currentGuideIds=new Set<string>();
  try{
    const available=await sql`select epg_id from lounge_delivery.shared_epg_channels
      where expires_at>now() and programme_count>0`;
    const ids=new Set(available.map((x:any)=>String(x.epg_id)));
    for(const id of ids) currentGuideIds.add(id);
    for(const row of rows){
      if(ids.has(String(row.epg_id||"")))continue;
      const alias=qaEpgAlias(nuvioGroup(row),String(row.display_name||""));
      if(alias&&ids.has(alias))row.epg_id=alias;
    }
  }catch(err){console.error("LOUNGE_NUVIO_QA_EPG_ALIAS_FALLBACK",String(err));}
  rows.sort((a:any,b:any)=>{
   const groupA=nuvioGroup(a),groupB=nuvioGroup(b);
   const ga=NUVIO_VISIBLE_ORDER.indexOf(groupA),gb=NUVIO_VISIBLE_ORDER.indexOf(groupB);
   if(ga!==gb)return ga-gb;
   const sa=nuvioChannelPriority(groupA,a,currentGuideIds.has(String(a.epg_id||"")));
   const sb=nuvioChannelPriority(groupB,b,currentGuideIds.has(String(b.epg_id||"")));
   if(sa!==sb)return sa-sb;
   return String(a.display_name).localeCompare(String(b.display_name),undefined,{numeric:true,sensitivity:"base"});
  });
  catalogueCache.set(k,{until:Date.now()+120000,rows});
  return rows;
 });
}
// QA only: labels keep the Xtream IDs and channel linkage unchanged.
// Prefixes preserve priority order even when Nuvio alphabetically sorts categories.
const NUVIO_CATEGORY_LABELS:Record<string,string>=masterCategoryLabels;
function nuvioVisibleLabels(rows:any[]):Record<string,string>{
 const present=new Set(rows.map((r:any)=>nuvioGroup(r)));
 const visible=NUVIO_VISIBLE_ORDER.filter(g=>present.has(g));
 return Object.fromEntries(visible.map((g,i)=>{
  const display=String(NUVIO_CATEGORY_LABELS[g]||g).replace(/^\d{2}\s+/,"");
  return [g,String(i+1).padStart(2,"0")+" "+display];
 }));
}
async function nuvioLiveCategories(){
 const rows=await nuvioFullRows(),labels=nuvioVisibleLabels(rows);
 return NUVIO_VISIBLE_ORDER.filter(g=>Boolean(labels[g])).map(g=>({
  category_id:nuvioGroupId(g),
  category_name:labels[g]
 }));
}

async function releaseLoungeLiveCategories(){
  const rel=await activeRelease(); if(!rel)return [];
  const rows=await sql`
    select l.category,l.subcategory
    from lounge_delivery.live_release_items l
    left join lounge_delivery.categories top
      on top.release_id=l.release_id
      and top.kind='live' and top.parent_key is null
      and top.enabled and top.display_name=l.category
    where l.release_id=${rel.id}::uuid and l.admission='keep'
    group by l.category,l.subcategory
    order by min(top.sort_order) nulls last,
             lower(l.category),lower(l.subcategory),l.subcategory
  `;
  return rows.map((r:any)=>({
    category_id:loungeLivePresentationId(r.category,r.subcategory),
    category_name:loungeLivePresentationName(r.category,r.subcategory),
  }));
}
async function releaseCategories(kind:"live"|"movie"|"series"){
  const rel=await activeRelease(); if(!rel)return [];
  return await sql`
    select id::text category_id,display_name category_name
    from lounge_delivery.categories
    where release_id=${rel.id}::uuid and kind=${kind} and enabled
      and (${kind}::text='live' or category_key not in ('featured','new-releases','trending','popular'))
    order by sort_order,id
  `;
}
async function releaseLiveRows(categoryId:number|null){
  const rel=await activeRelease(); if(!rel)return [];
  const cacheKey="release-live:"+rel.id+":"+(categoryId??"all");
  const hit=catalogueCache.get(cacheKey);
  if(hit&&hit.until>Date.now()) return hit.rows;
  return await shareCatalogue(cacheKey,async()=>{
    const secondHit=catalogueCache.get(cacheKey);
    if(secondHit&&secondHit.until>Date.now()) return secondHit.rows;
    const rows=await sql`
      select i.external_id,l.live_channel_id,l.canonical_key,l.display_name,l.category,l.subcategory,
             l.logo_url,l.epg_id,l.sort_order,
             b.provider_stream_id,coalesce(b.source_format,'ts') source_format,p.name provider_name,
             cat.id category_id,cat.display_name category_name
      from lounge_delivery.live_release_items l
      join lounge_delivery.item_ids i on i.item_kind='live' and i.canonical_id=l.live_channel_id
      join lounge_delivery.live_source_bindings b
        on b.release_id=l.release_id and b.live_channel_id=l.live_channel_id and b.source_role='primary'
      join public.providers p on p.id=b.provider_id
      left join lateral (
        select c.id,c.display_name
        from lounge_delivery.category_members m
        join lounge_delivery.categories c on c.id=m.category_id and c.release_id=m.release_id and c.kind='live' and c.enabled
        where m.release_id=l.release_id and m.item_kind='live' and m.canonical_id=l.live_channel_id
        order by c.sort_order,c.id limit 1
      ) cat on true
      where l.release_id=${rel.id}::uuid and l.admission='keep'
        and (${categoryId}::bigint is null or exists(
          select 1 from lounge_delivery.category_members mx
          where mx.release_id=l.release_id and mx.item_kind='live' and mx.canonical_id=l.live_channel_id and mx.category_id=${categoryId}
        ))
      order by l.sort_order,i.external_id
    `;
    catalogueCache.set(cacheKey,{until:Date.now()+120000,rows});
    return rows;
  });
}
function loungeMovieQualityRank(height:unknown){
  const h=Number(height||0);
  if(h>=4000)return 5;
  if(h>=2000)return 4;
  if(h>=1000)return 3;
  if(h>=700)return 2;
  if(h>0)return 1;
  return 0;
}
function loungeMovieCodecLabel(raw:unknown){
  const v=String(raw||"").trim().toLowerCase();
  if(!v)return "";
  if(v==="h264"||v==="avc"||v==="avc1")return "H.264";
  if(v==="h265"||v==="hevc"||v==="hev1"||v==="hvc1")return "HEVC";
  if(v==="av1"||v==="av01")return "AV1";
  if(v==="aac")return "AAC";
  if(v==="ac3"||v==="ac-3")return "AC3";
  if(v==="eac3"||v==="e-ac-3"||v==="eac-3")return "E-AC3";
  if(v==="dts")return "DTS";
  return v.toUpperCase();
}
function loungeMovieCapabilities(row:any){
  return [loungeMovieCodecLabel(row?.video_codec),loungeMovieCodecLabel(row?.audio_codec)]
    .filter(Boolean).join(" • ");
}
async function releaseVodRows(type:"movie"|"series",categoryId:number|null){
  const rel=await activeRelease(); if(!rel)return [];
  const cacheKey="release-vod:"+rel.id+":"+type+":"+(categoryId??"all");
  const hit=catalogueCache.get(cacheKey);
  if(hit&&hit.until>Date.now()) return hit.rows;
  return await shareCatalogue(cacheKey,async()=>{
    const secondHit=catalogueCache.get(cacheKey);
    if(secondHit&&secondHit.until>Date.now()) return secondHit.rows;
    const rows=await sql`
      with primary_cat as (
        select distinct on (m.canonical_id)
          m.canonical_id,c.id category_id,c.display_name category_name
        from lounge_delivery.category_members m
        join lounge_delivery.categories c
          on c.id=m.category_id and c.release_id=m.release_id
         and c.kind=${type} and c.enabled
         and c.category_key not in ('featured','new-releases','trending','popular')
        where m.release_id=${rel.id}::uuid
          and m.item_kind=${type}::lounge_delivery.item_kind
        order by m.canonical_id,c.sort_order,c.id
      )
      select i.external_id,v.title_id,v.display_name,v.poster_url,v.backdrop_url,v.sort_order,v.editorial,
             coalesce(src.provider_item_id,(v.editorial->>'primary_provider_item_id')::bigint) provider_item_id,
             src.file_ext,src.resolution_height,src.video_codec,src.audio_codec,
             pc.category_id,pc.category_name
      from lounge_delivery.vod_release_items v
      join lounge_delivery.item_ids i
        on i.item_kind=${type}::lounge_delivery.item_kind and i.canonical_id=v.title_id
      left join primary_cat pc on pc.canonical_id=v.title_id
      left join lateral (
        select s.provider_item_id,s.file_ext,s.resolution_height,s.video_codec,s.audio_codec
        from lounge_core.sources s
        join public.providers p on p.id=s.provider_id and p.name='BEST'
        left join lounge_sync.best_inventory_items bi
          on bi.kind='movies' and bi.provider_item_id=s.provider_item_id
        where ${type}::text='movie'
          and s.title_id=v.title_id
          and s.status not in ('rejected','missing','hidden')
          and coalesce(bi.is_present,true)
        order by
          case when s.runtime_health='good' and s.runtime_verified=true
                    and s.last_runtime_verified_at>now()-interval '24 hours' then 0
               when s.runtime_health='good' and s.runtime_verified=true then 1
               when s.runtime_health in ('unknown','degraded') then 2
               else 3 end,
          case when s.provider_item_id=(v.editorial->>'primary_provider_item_id')::bigint then 0 else 1 end,
          case s.status when 'verified' then 0 when 'candidate' then 1 when 'degraded' then 2 else 3 end,
          s.quality_score desc nulls last,
          s.provider_item_id
        limit 1
      ) src on true
      where v.release_id=${rel.id}::uuid
        and v.content_type=${type}
        and v.admission='keep'
        and (${categoryId}::bigint is null or exists(
          select 1 from lounge_delivery.category_members mx
          where mx.release_id=v.release_id
            and mx.item_kind=${type}::lounge_delivery.item_kind
            and mx.canonical_id=v.title_id
            and mx.category_id=${categoryId}
        ))
      order by v.sort_order,i.external_id
    `;
    catalogueCache.set(cacheKey,{until:Date.now()+600000,rows});
    return rows;
  });
}
async function releaseLivePlayback(externalId:number){
  const rel=await activeRelease(); if(!rel)return null;
  const rows=await sql`
    select b.provider_stream_id,coalesce(b.source_format,'ts') source_format,l.canonical_key,l.epg_id,l.display_name,l.category,l.subcategory,p.name provider_name
    from lounge_delivery.item_ids i
    join lounge_delivery.live_release_items l
      on l.live_channel_id=i.canonical_id and l.release_id=${rel.id}::uuid and l.admission='keep'
    join lounge_delivery.live_source_bindings b
      on b.release_id=l.release_id and b.live_channel_id=l.live_channel_id and b.source_role='primary'
    join public.providers p on p.id=b.provider_id
    where i.item_kind='live' and i.external_id=${externalId}
    limit 1
  `;
  return rows.length?qaSkySwapPrimary(rows[0]):null;
}
async function releaseMoviePlayback(externalId:number){
  const rel=await activeRelease(); if(!rel)return null;
  const rows=await sql`
    select s.id source_id,s.provider_item_id,coalesce(s.file_ext,'mp4') file_ext,
           s.status,s.source_role,s.quality_score,s.runtime_health,s.runtime_verified,
           s.last_runtime_verified_at,
           (v.editorial->>'primary_provider_item_id')::bigint release_primary_provider_item_id
    from lounge_delivery.item_ids i
    join lounge_delivery.vod_release_items v
      on v.title_id=i.canonical_id and v.release_id=${rel.id}::uuid
      and v.content_type='movie' and v.admission='keep'
    join lounge_core.sources s on s.title_id=v.title_id
    join public.providers p on p.id=s.provider_id and p.name='BEST'
    join lounge_sync.best_inventory_items bi
      on bi.kind='movies' and bi.provider_item_id=s.provider_item_id and bi.is_present=true
    where i.item_kind='movie' and i.external_id=${externalId}
      and s.status not in ('rejected','missing','hidden')
    order by
      case when s.runtime_health='good' and s.runtime_verified=true
                 and s.last_runtime_verified_at>now()-interval '24 hours' then 0
           when s.runtime_health='good' and s.runtime_verified=true then 1
           when s.runtime_health in ('unknown','degraded') then 2
           else 3 end,
      case when s.provider_item_id=(v.editorial->>'primary_provider_item_id')::bigint then 0 else 1 end,
      case s.status when 'verified' then 0 when 'candidate' then 1 when 'degraded' then 2 else 3 end,
      s.quality_score desc nulls last,
      s.provider_item_id
  `;
  if(!rows.length)return null;

  // A source proven good in the last 24h opens immediately.
  const freshGood=rows.find((r:any)=>
    r.runtime_health==='good'&&r.runtime_verified===true&&r.last_runtime_verified_at&&
    (Date.now()-new Date(r.last_runtime_verified_at).getTime())<24*60*60*1000
  );
  if(freshGood)return freshGood;

  // Never make the customer discover a dead file. Probe up to three candidate copies
  // with Lounge's dedicated catalogue line, then redirect the customer's own line only
  // after bytes have actually been observed.
  const candidates=rows.filter((r:any)=>{
    if(r.runtime_health!=='dead'||!r.last_runtime_verified_at)return true;
    return (Date.now()-new Date(r.last_runtime_verified_at).getTime())>24*60*60*1000;
  }).slice(0,3);

  for(const source of candidates){
    if(await runtimeProbeMovieSource(source))return source;
  }
  return null;
}
async function releaseEpisodePlayback(externalId:number){
  const rel=await activeRelease(); if(!rel)return null;
  const rows=await sql`
    select es.provider_episode_id,es.provider_series_item_id,coalesce(es.file_ext,'mkv') file_ext
    from lounge_delivery.item_ids i
    join lounge_core.episodes e on e.id=i.canonical_id
    join lounge_core.seasons se on se.id=e.season_id
    join lounge_delivery.vod_release_items v
      on v.title_id=se.series_title_id and v.release_id=${rel.id}::uuid and v.content_type='series' and v.admission='keep'
    join lateral (
      select x.provider_episode_id,x.provider_series_item_id,x.file_ext
      from lounge_core.episode_sources x
      where x.episode_id=e.id and x.status in ('verified','candidate','degraded')
      order by
        case when x.provider_series_item_id=(v.editorial->>'primary_provider_item_id')::bigint then 0 else 1 end,
        case x.status when 'verified' then 0 when 'candidate' then 1 else 2 end,
        x.runtime_verified desc,x.quality_score desc
      limit 1
    ) es on true
    where i.item_kind='episode' and i.external_id=${externalId}
    limit 1
  `;
  return rows[0]||null;
}
async function releaseMovieInfo(externalId:number){
  const rel=await activeRelease(); if(!rel)return null;
  const rows=await sql`
    select i.external_id,v.title_id,v.display_name,v.poster_url,v.backdrop_url,v.editorial,
           t.release_year,t.release_date,t.overview,t.runtime_minutes,t.metadata,
           (v.editorial->>'primary_provider_item_id')::bigint provider_item_id,
           coalesce((select s.file_ext from lounge_core.sources s
             where s.title_id=v.title_id and s.provider_item_id=(v.editorial->>'primary_provider_item_id')::bigint
               and s.status not in ('rejected','missing','hidden')
             order by case s.source_role when 'primary' then 0 when 'backup' then 1 else 2 end,s.quality_score desc limit 1),'mp4') file_ext
    from lounge_delivery.item_ids i
    join lounge_delivery.vod_release_items v
      on v.title_id=i.canonical_id and v.release_id=${rel.id}::uuid and v.content_type='movie' and v.admission='keep'
    join lounge_core.titles t on t.id=v.title_id
    where i.item_kind='movie' and i.external_id=${externalId}
    limit 1
  `;
  if(!rows.length)return null;
  const r:any=rows[0],m=r.metadata||{};
  const genres=await sql`select g.name from lounge_core.title_genres tg join lounge_core.genres g on g.id=tg.genre_id where tg.title_id=${String(r.title_id)}::uuid order by g.name`;
  const cast=Array.isArray(m.cast)?m.cast.map((x:any)=>x?.name).filter(Boolean).slice(0,15).join(", "):"";
  return {
    info:{tmdb_id:m.tmdb_id??r.editorial?.tmdb_id??null,name:r.display_name,original_name:r.display_name,movie_image:r.poster_url||"",plot:r.overview||"",description:r.overview||"",
      releasedate:r.release_date||"",year:r.release_year||null,genre:genres.map((x:any)=>x.name).join(", "),cast,rating:Number(m.vote_average||0),
      duration_secs:r.runtime_minutes?Number(r.runtime_minutes)*60:0,backdrop_path:r.backdrop_url?[r.backdrop_url]:[]},
    movie_data:{stream_id:Number(r.external_id),name:r.display_name,container_extension:r.file_ext||"mp4",custom_sid:null,direct_source:""},
    provider_item_id:Number(r.provider_item_id)
  };
}
async function releaseSeriesInfo(externalId:number){
  const rel=await activeRelease(); if(!rel)return null;
  const srows=await sql`
    select i.external_id,v.title_id,v.display_name,v.poster_url,v.backdrop_url,v.editorial,
           t.overview,t.release_date,t.release_year,t.metadata
    from lounge_delivery.item_ids i
    join lounge_delivery.vod_release_items v on v.title_id=i.canonical_id and v.release_id=${rel.id}::uuid and v.content_type='series' and v.admission='keep'
    join lounge_core.titles t on t.id=v.title_id
    where i.item_kind='series' and i.external_id=${externalId}
    limit 1
  `;
  if(!srows.length)return null;
  const s:any=srows[0];
  const primarySeriesProviderItemId=Number(s.editorial?.primary_provider_item_id||0);
  const rows=await sql`
    select se.season_number,se.title season_title,se.poster_url season_poster,
           e.episode_number,e.title,e.overview,e.release_date,e.still_url,
           ei.external_id episode_external_id,
           src.file_ext
    from lounge_core.seasons se
    join lounge_core.episodes e on e.season_id=se.id and e.status<>'excluded'
    join lounge_delivery.item_ids ei on ei.item_kind='episode' and ei.canonical_id=e.id
    join lateral (
      select es.file_ext
      from lounge_core.episode_sources es
      where es.episode_id=e.id and es.status in ('verified','candidate','degraded')
      order by
        case when es.provider_series_item_id=${primarySeriesProviderItemId} then 0 else 1 end,
        case es.status when 'verified' then 0 when 'candidate' then 1 else 2 end,
        es.runtime_verified desc,es.quality_score desc
      limit 1
    ) src on true
    where se.series_title_id=${String(s.title_id)}::uuid and se.status<>'excluded'
    order by se.season_number,e.episode_number
  `;
  const episodes:Record<string,unknown[]>={};const seasons=new Map<number,any>();
  for(const r of rows){
    const n=Number(r.season_number),k=String(n);
    if(!seasons.has(n))seasons.set(n,{air_date:null,episode_count:0,id:n,name:r.season_title||("Season "+n),overview:"",season_number:n,cover:r.season_poster||""});
    const season=seasons.get(n);season.episode_count++;
    (episodes[k]??=[]).push({id:String(r.episode_external_id),episode_num:Number(r.episode_number),title:String(r.title||""),container_extension:r.file_ext||"mkv",season:n,
      release_date:r.release_date?new Date(r.release_date).toISOString().slice(0,10):null,info:{plot:r.overview||"",movie_image:r.still_url||""}});
  }
  const m=s.metadata||{};
  return {
    info:{name:s.display_name,cover:s.poster_url||"",plot:s.overview||"",cast:Array.isArray(m.cast)?m.cast.map((x:any)=>x?.name).filter(Boolean).slice(0,15).join(", "):"",
      rating:Number(m.vote_average||0),releaseDate:s.release_date||"",year:s.release_year||null,backdrop_path:s.backdrop_url?[s.backdrop_url]:[]},
    seasons:[...seasons.values()].sort((a:any,b:any)=>a.season_number-b.season_number),episodes,
    provider_item_id:Number(s.editorial?.primary_provider_item_id)
  };
}
async function releaseM3u(u:string,p:string,url:URL){
  const rows=await nuvioFullRows();
  const labels=nuvioVisibleLabels(rows);
  const forwardedHost=url.searchParams.get("_lounge_host")||"";
  const base=forwardedHost?("https://"+forwardedHost):(SUPABASE_URL+"/functions/v1/lounge-international-master-v4-qa");
  const epg=base+"/xmltv.php?username="+encodeURIComponent(u)+"&password="+encodeURIComponent(p);
  const lines=[`#EXTM3U x-tvg-url="${epg}"`];
  let no=1;
  for(const r of rows){
    // Match the existing Xtream category presentation in this single full M3U.
    const group=labels[nuvioGroup(r)]||nuvioGroup(r);
    const tvg=String(effectiveLiveEpgId(r)||("ltv-"+r.external_id));
    lines.push(`#EXTINF:-1 channel-id="ltv-${r.external_id}" tvg-id="${xmlEsc(tvg)}" tvg-logo="${xmlEsc(r.logo_url||"")}" tvg-chno="${no++}" group-title="${xmlEsc(group)}",${String(r.display_name)}`);
    const nz=nzSourceForBinding(r.provider_name,r.provider_stream_id);
    if(nz) lines.push(...nzPlaylistLines(nz));
    else lines.push(base+"/live/"+encodeURIComponent(u)+"/"+encodeURIComponent(p)+"/"+Number(r.external_id)+"."+String(r.source_format||"ts"));
  }
  return new Response(lines.join("\n")+"\n",{status:200,headers:{"Content-Type":"application/x-mpegURL; charset=utf-8","Cache-Control":"private, max-age=120","Access-Control-Allow-Origin":"*"}});
}
/**
 * International QA EPG: emit only genuine programme rows for IDs present in
 * the selected catalogue. Stream XMLTV in batches; avoid pulling the 90 MB
 * production guide into this free-tier Edge Function's memory.
 */
async function internationalQaXmltv(req:Request){
 const rows=await nuvioFullRows();
 const candidateIds=[...new Set(rows.map((r:any)=>String(effectiveLiveEpgId(r)||"")).filter(Boolean))];
 const eligible=await sql`
   SELECT epg_id FROM lounge_delivery.shared_epg_channels
   WHERE epg_id=any(${candidateIds}::text[])
     AND programme_count>0 AND expires_at>now()
   ORDER BY epg_id
 `;
 const ids=eligible.map((x:any)=>String(x.epg_id));
 const encoder=new TextEncoder();
 const xml=new ReadableStream<Uint8Array>({
   async start(controller){
     try{
       controller.enqueue(encoder.encode('<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="Lounge TV International QA">\n'));
       for(let start=0;start<ids.length;start+=25){
         const batch=ids.slice(start,start+25);
         const parts=await sql`SELECT xmltv FROM lounge_delivery.shared_epg_channels
           WHERE epg_id=any(${batch}::text[]) AND programme_count>0 AND expires_at>now()
           ORDER BY epg_id`;
         for(const p of parts){
           if(p.xmltv)controller.enqueue(encoder.encode(String(p.xmltv)+"\n"));
         }
       }
       controller.enqueue(encoder.encode("</tv>\n"));
       controller.close();
     }catch(e){controller.error(e);}
   }
 });
 const canGzip=/\bgzip\b/i.test(req.headers.get("accept-encoding")||"");
 const headers:Record<string,string>={
   "Content-Type":"application/xml; charset=utf-8",
   "Cache-Control":"private, max-age=300",
   "Access-Control-Allow-Origin":"*",
   "X-Lounge-Guide-Scope":"selected-qa"
 };
 if(canGzip)headers["Content-Encoding"]="gzip";
 return new Response(canGzip?xml.pipeThrough(new CompressionStream("gzip")):xml,
   {status:200,headers});
}
let skyNzShortCache:{until:number,body:string}|null=null;
async function skyNzShortEpg(epgId:string,limit:number,externalId:number){
  const match=epgId.match(/^SkySport([1-9])\.nz$/);
  if(!match)return [];
  let body="";
  if(skyNzShortCache&&skyNzShortCache.until>Date.now()){
    body=skyNzShortCache.body;
  }else{
    try{
      const res=await fetch("https://m3u-edit.com/epg-source.php?file=NZ1.xml.gz",{
        headers:{"User-Agent":"LoungeTV-NZSkyGuide/1.0"},
        signal:AbortSignal.timeout(18000),
      });
      if(!res.ok)return [];
      const bytes=new Uint8Array(await res.arrayBuffer());
      if(bytes[0]===0x1f&&bytes[1]===0x8b){
        body=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
      }else{
        body=new TextDecoder().decode(bytes);
      }
      skyNzShortCache={until:Date.now()+10*60*1000,body};
    }catch(err){
      console.error("SKY_NZ_SHORT_SOURCE_ERROR",String(err));
      return [];
    }
  }
  const id="Sky.Sport."+match[1]+".nz";
  const re=new RegExp('<programme\\b(?=[^>]*\\bchannel=["\\x27]'+id.replace(/\./g,"\\.")+'["\\x27])[^>]*>[\\s\\S]*?<\\/programme>','gi');
  const now=Math.floor(Date.now()/1000);
  const out:any[]=[];
  let m:RegExpExecArray|null;
  while((m=re.exec(body))!==null){
    const block=m[0];
    const tag=block.slice(0,block.indexOf(">")+1);
    const start=xmltvEpoch(tag.match(/\bstart=["']([^"']+)/i)?.[1]||"");
    const stop=xmltvEpoch(tag.match(/\bstop=["']([^"']+)/i)?.[1]||"");
    if(!start||!stop||stop<now-900)continue;
    const title=xmlText(block.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1]||"");
    if(!title)continue;
    const description=xmlText(block.match(/<desc(?:\s[^>]*)?>([\s\S]*?)<\/desc>/i)?.[1]||"");
    out.push({
      id:null,epg_id:externalId,title:b64(title),lang:"en",
      start:new Date(start*1000).toISOString(),end:new Date(stop*1000).toISOString(),
      description:b64(description),channel_id:"ltv-"+externalId,
      start_timestamp:start,stop_timestamp:stop,
      now_playing:start<=now&&stop>now?1:0,has_archive:0,
    });
  }
  out.sort((a,b)=>Number(a.start_timestamp)-Number(b.start_timestamp));
  return out.slice(0,limit);
}

async function releaseShortEpg(base:string,u:string,p:string,externalId:number,limit:number){
  // QA-only Nuvio extension: raw BEST overlay IDs were not represented in
  // releaseLivePlayback(), causing get_short_epg to return [] despite valid XMLTV.
  // Use only existing shared/static guide sources, never 13k provider EPG calls.
  if(externalId>=NUVIO_STREAM_BASE){
    const mapped=(await nuvioFullRows()).find((row:any)=>Number(row.external_id)===externalId);
    if(!mapped)return [];
    const epgId=effectiveLiveEpgId(mapped);
    if(!epgId)return [];
    const existing=await staticShortEpg(epgId,limit,externalId);
    if(existing&&existing.length)return existing;
    const sky=await skyNzShortEpg(epgId,limit,externalId);
    if(sky&&sky.length)return sky;
    return [];
  }
  const mapped:any=await releaseLivePlayback(externalId); if(!mapped)return [];
  if(qaAuWrongGuide(mapped))return []; // no Ten->10 Bold nor unverified provider fallback
  const epgId=effectiveLiveEpgId(mapped);
  // The curated short-EPG path must use the same verified alias as
  // get_live_streams. Previously Seven and AU Fox Sports showed a valid
  // EPG channel ID in the list but get_short_epg stayed empty.
  const aliasGuideId=qaEpgAlias(nuvioGroup(mapped),String(mapped.display_name||""));
  if(aliasGuideId&&aliasGuideId!==epgId){
    const aliasGuide=await staticShortEpg(aliasGuideId,limit,externalId);
    if(aliasGuide&&aliasGuide.length)return aliasGuide;
  }
  const staticGuide=await staticShortEpg(epgId,limit,externalId);
  if(staticGuide&&staticGuide.length)return staticGuide;
  const nzSkyGuide=await skyNzShortEpg(epgId,limit,externalId);
  if(nzSkyGuide&&nzSkyGuide.length)return nzSkyGuide;
  const skyGuide=await skyCinemaShortEpg(epgId,limit,externalId);
  if(skyGuide&&skyGuide.length)return skyGuide;
  const xmlGuide=await xmltvShortEpg(epgId,limit,externalId);
  if(xmlGuide&&xmlGuide.length)return xmlGuide;

  // Provider EPG remains a last-resort fallback for ids not yet covered by the
  // canonical static guide. BEST currently returns 404 for many of these calls.
  const q=new URL(base+"/player_api.php");
  q.searchParams.set("username",u);q.searchParams.set("password",p);q.searchParams.set("action","get_short_epg");
  q.searchParams.set("stream_id",String(mapped.provider_stream_id));q.searchParams.set("limit",String(limit));
  try{
    const rr=await fetch(q,{headers:{Accept:"application/json","User-Agent":"LoungeTV-Gateway/1.0"},signal:AbortSignal.timeout(8000)});
    const body=await rr.json().catch(()=>null); const list=Array.isArray(body?.epg_listings)?body.epg_listings:[];
    return list.map((x:any)=>({...x,channel_id:"ltv-"+externalId,epg_id:externalId}));
  }catch{return [];}
}

async function allowed(kind:"live"|"movie"|"series",id:string){
  const n=Number(id.replace(/\..*$/,"")); if(!Number.isFinite(n))return false;
  if(kind==="live"){
    const r=await sql`select 1 from lounge_core.live_sources s join public.providers p on p.id=s.provider_id join lounge_core.live_channels c on c.id=s.live_channel_id where p.name='BEST' and s.provider_stream_id=${n} and s.status<>'rejected' and c.status in ('staging','approved') limit 1`; return r.length>0;
  }
  if(kind==="movie"){
    const r=await sql`select 1 from lounge_core.sources s join public.providers p on p.id=s.provider_id join lounge_core.titles t on t.id=s.title_id where p.name='BEST' and s.provider_kind='movies' and s.provider_item_id=${n} and s.status not in ('rejected','hidden','missing') and t.status<>'excluded' limit 1`; return r.length>0;
  }
  const r=await sql`select 1 from lounge_core.episode_sources es join public.providers p on p.id=es.provider_id where p.name='BEST' and es.provider_episode_id=${String(n)} and es.status not in ('rejected','missing') limit 1`; return r.length>0;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*"}});
  const url=new URL(req.url);
  const marker="/lounge-international-master-v4-qa";
  const rest=url.pathname.includes(marker)?url.pathname.split(marker)[1]||"/":url.pathname;
  const parts=rest.split("/").filter(Boolean);
  const base=await bestBase();

  if(parts[0]==="sport"){
    const {u,p}=credentials(url,parts);
    const idPart=parts[3]||"";
    const providerItemId=Number(idPart.split(".")[0]);
    if(!u||!p||!Number.isFinite(providerItemId)) return json({error:"not_allowed"},403);
    const auth=await catalogueAccountState(base,u,p);
    if(!auth.ok) return json({error:"not_allowed"},403);
    if(!(await sportsProviderStreamAllowed(providerItemId))) return json({error:"not_allowed"},403);
    return Response.redirect(base+"/live/"+encodeURIComponent(u)+"/"+encodeURIComponent(p)+"/"+providerItemId+".ts",302);
  }
  if(parts[0]==="live"){
    const {u,p}=credentials(url,parts);const idPart=parts[3]||"";const externalId=Number(idPart.split(".")[0]);
    if(!u||!p||!Number.isFinite(externalId)) return json({error:"not_allowed"},403);
    if(externalId>=NUVIO_STREAM_BASE){
      const rawId=externalId-NUVIO_STREAM_BASE;
      const auth=await catalogueAccountState(base,u,p);
      if(!auth.ok)return json({error:"not_allowed"},403);
      const found=(await nuvioFullRows()).some((r:any)=>Number(r.external_id)===externalId);
      if(!found)return json({error:"not_allowed"},403);
      return Response.redirect(base+"/live/"+encodeURIComponent(u)+"/"+encodeURIComponent(p)+"/"+rawId+".ts",302);
    }
    const mapped:any=await releaseLivePlayback(externalId);
    if(!mapped) return json({error:"not_allowed"},403);
    if(mapped.provider_name!=="BEST"){
      const auth=await catalogueAccountState(base,u,p);
      if(!auth.ok) return json({error:"not_allowed"},403);
      const nz=nzSourceForBinding(mapped.provider_name,mapped.provider_stream_id);
      if(!nz) return json({error:"unsupported_source_provider"},502);
      if(nz.drm) return json({error:"drm_client_required",message:"TVNZ requires a Widevine-capable player and the M3U DRM metadata"},422);
      return Response.redirect(nz.url,302);
    }
    const ext=String(mapped.source_format||"ts").replace(/[^a-z0-9]/gi,"")||"ts";
    // BEST validates the customer's credentials on the redirected stream itself.
    // Avoid a second provider round-trip before every channel start.
    return Response.redirect(base+"/live/"+encodeURIComponent(u)+"/"+encodeURIComponent(p)+"/"+Number(mapped.provider_stream_id)+"."+ext,302);
  }
  if(parts[0]==="movie"||parts[0]==="series"){
    const kind=parts[0] as "movie"|"series";const {u,p}=credentials(url,parts);const idPart=parts[3]||"";
    const externalId=Number(idPart.split(".")[0]);if(!u||!p||!Number.isFinite(externalId)) return json({error:"not_allowed"},403);
    if(kind==="movie"){
      const mapped:any=await releaseMoviePlayback(externalId);
      if(!mapped)return json({error:"movie_source_unavailable"},503);
      const ext=String(mapped.file_ext||"mp4").replace(/[^a-z0-9]/gi,"")||"mp4";
      return Response.redirect(base+"/movie/"+encodeURIComponent(u)+"/"+encodeURIComponent(p)+"/"+Number(mapped.provider_item_id)+"."+ext,302);
    }
    const mapped:any=await releaseEpisodePlayback(externalId);if(!mapped)return json({error:"not_allowed"},403);
    const ext=String(mapped.file_ext||"mkv").replace(/[^a-z0-9]/gi,"")||"mkv";
    return Response.redirect(base+"/series/"+encodeURIComponent(u)+"/"+encodeURIComponent(p)+"/"+String(mapped.provider_episode_id)+"."+ext,302);
  }
  if(parts[0]==="xmltv.php"){
    const {u,p}=credentials(url,parts);
    const auth=await accountState(base,u,p);
    if(!auth.ok)return json({error:"not_allowed"},403);
    if(RECOVERY_MODE)return await providerXmltv(base,u,p);
    return await internationalQaXmltv(req);
  }
  if(parts[0]==="get.php"){const {u,p}=credentials(url,parts);const auth=await accountState(base,u,p);if(!auth.ok)return json({error:"not_allowed"},403);if(RECOVERY_MODE)return await providerM3u(base,u,p);return await releaseM3u(u,p,url);}

  if(parts[0]!=="player_api.php" && parts.length>0) return json({error:"not_found"},404);
  const {u,p}=credentials(url,parts);
  const action=url.searchParams.get("action");
  if(!action) return await accountRelay(base,u,p,url);
  const auth=await catalogueAccountState(base,u,p);
  if(!auth.ok) return json({user_info:{auth:0,status:"Disabled"}},401);
  if(RECOVERY_MODE) return await providerApiRelay(base,u,p,url);

  // Active release catalogue is the customer-facing source of truth.

  // LOUNGE_DB_RECOVERY_ACTIONS
  try{
  // Canonical Lounge category/subcategory presentation is now the default customer contract.
  // Third-party players receive the same stable Xtream-compatible flat category list, while
  // the Lounge Android app re-groups those names into its richer section accordion.
  const loungeApp=true;
  if(action==="qa_epg_summary"){
    const rows=await nuvioFullRows();
    const [current,matches]=await Promise.all([
      sql`SELECT epg_id FROM lounge_delivery.shared_epg_channels WHERE programme_count>0 AND expires_at>now()`,
      sql`SELECT provider_stream_id,decision,basis,proposed_epg_id,last_programme_end
          FROM lounge_sync.international_epg_matches_qa_20261119`
    ]);
    const verified=new Set(current.map((x:any)=>String(x.epg_id)));
    const mapping=new Map(matches.map((x:any)=>[Number(x.provider_stream_id),x]));
    const stats={visible:rows.length,current_shared_guide:0,new_qa_candidate:0,needs_review:0};
    const counts=new Map<string,{channels:number,current_guide:number,new_qa_candidate:number,review:number}>();
    for(const item of rows){
      const group=nuvioGroup(item),r=counts.get(group)||{channels:0,current_guide:0,new_qa_candidate:0,review:0};
      r.channels++;
      const liveGuide=verified.has(String(effectiveLiveEpgId(item)||""));
      const m=mapping.get(Number(item.provider_stream_id));
      if(liveGuide){stats.current_shared_guide++;r.current_guide++;}
      else if(m?.decision==="qa_accepted"&&new Date(String(m.last_programme_end||"")).getTime()>Date.now()){stats.new_qa_candidate++;r.new_qa_candidate++;}
      else if(m?.decision==="review_required"){stats.needs_review++;r.review++;}
      counts.set(group,r);
    }
    const groups=NUVIO_VISIBLE_ORDER.filter(x=>counts.has(x)).map(x=>({name:x,...counts.get(x)}));
    return json({scope:"International Master QA only",status:"metadata_only_not_device_epg",
      ...stats,groups,warning:"Additional QA candidates require programme delivery and licensing review. Do not count them as EPG displayed in Nuvio."});
  }
  if(action==="qa_summary"){
    const rows=await nuvioFullRows(),labels=nuvioVisibleLabels(rows);
    const gids=await sql`SELECT epg_id FROM lounge_delivery.shared_epg_channels WHERE expires_at>now() AND programme_count>0`;
    const guideIds=new Set(gids.map((x:any)=>String(x.epg_id)));
    const counts=new Map<string,{count:number,logos:number,guide:number}>();
    for(const row of rows){
      const g=nuvioGroup(row),v=counts.get(g)||{count:0,logos:0,guide:0};
      v.count++;if(row.logo_url)v.logos++;if(guideIds.has(String(row.epg_id||"")))v.guide++;
      counts.set(g,v);
    }
    const categories=NUVIO_VISIBLE_ORDER.filter(g=>Boolean(labels[g])).map(g=>({name:labels[g],...counts.get(g)}));
    return json({source:"international-master-trial-qa",total:rows.length,category_count:categories.length,
      verified_guide:categories.reduce((n,c)=>n+(c.guide||0),0),categories});
  }
  if(action==="get_live_categories"){
    return json(await nuvioLiveCategories());
  }
  if(action==="get_live_streams"){
    // NZ/AU Nuvio gateway: send every authenticated account through the proven
    // get.php fallback so M3U DRM metadata reaches TVNZ 1 and TVNZ 2.
    // Account authentication occurs above this branch. Other action routes
    // and the separate production lounge-core-xtream function are unchanged.
    return json({error:"nuvio_m3u_drm_fallback_required",detail:"Retry get.php for DRM-aware M3U playlist"},503);
    if(loungeApp){
      const wanted=url.searchParams.get("category_id");
      const rows=await nuvioFullRows();
      const filtered=wanted
        ? rows.filter((r:any)=>nuvioGroupId(nuvioGroup(r))===wanted)
        : rows;
      // The full Xtream import contains PPV rows. Never let their presence
      // alphabetise every group and override nuvioFullRows() priority ranking.
      // Live Events are already alphabetised within their group upstream.
      const visible=filtered;
      return json(visible.map((r:any,i:number)=>({
        num:i+1,name:String(r.display_name),stream_type:"live",stream_id:Number(r.external_id),
        stream_icon:r.logo_url||"",epg_channel_id:effectiveLiveEpgId(r)||("ltv-"+r.external_id),
        added:"0",category_id:nuvioGroupId(nuvioGroup(r)),
        custom_sid:"",tv_archive:0,direct_source:"",tv_archive_duration:0,
        ...qaTvnzXtreamDrmFields(r)
      })));
    }
    const wantedRaw=Number(url.searchParams.get("category_id")||0);
    const wanted=Number.isFinite(wantedRaw)&&wantedRaw>0?wantedRaw:null;
    const rows=await releaseLiveRows(wanted);
    return json(rows.map((r:any,i:number)=>({
      num:i+1,name:String(r.display_name),stream_type:"live",stream_id:Number(r.external_id),
      stream_icon:r.logo_url||"",epg_channel_id:effectiveLiveEpgId(r)||("ltv-"+r.external_id),
      added:"0",category_id:r.category_id?String(r.category_id):"0",custom_sid:"",tv_archive:0,direct_source:"",tv_archive_duration:0
    })));
  }
  if(action==="get_vod_categories") return json(await releaseCategories("movie"));
  if(action==="get_series_categories") return json(await releaseCategories("series"));
  if(action==="get_vod_streams"){
    const wantedRaw=Number(url.searchParams.get("category_id")||0);const wanted=Number.isFinite(wantedRaw)&&wantedRaw>0?wantedRaw:null;
    const rows=await releaseVodRows("movie",wanted);
    return json(rows.map((r:any,i:number)=>({
      num:i+1,name:String(r.display_name),stream_type:"movie",stream_id:Number(r.external_id),
      stream_icon:r.poster_url||"",rating:0,rating_5based:0,
      added:"0",category_id:r.category_id?String(r.category_id):"0",container_extension:String(r.file_ext||"mp4"),
      lounge_quality_rank:loungeMovieQualityRank(r.resolution_height),
      lounge_capabilities:loungeMovieCapabilities(r),
      custom_sid:null,direct_source:"",plot:""
    })));
  }
  if(action==="get_vod_info"){
    const externalId=Number(url.searchParams.get("vod_id")||0);const info:any=await releaseMovieInfo(externalId);
    if(!info)return json({error:"not_found"},404);
    const ids=await customerVodIds(base,u,p,"get_vod_streams");if(!ids)return json({error:"entitlement_unavailable"},502);
    if(!ids.has(Number(info.provider_item_id)))return json({error:"not_allowed"},403);
    const {provider_item_id,...publicInfo}=info;return json(publicInfo);
  }
  if(action==="get_series"){
    const wantedRaw=Number(url.searchParams.get("category_id")||0);const wanted=Number.isFinite(wantedRaw)&&wantedRaw>0?wantedRaw:null;
    const rows=await releaseVodRows("series",wanted);
    return json(rows.map((r:any,i:number)=>({
      num:i+1,name:String(r.display_name),series_id:Number(r.external_id),cover:r.poster_url||"",
      plot:"",cast:"",director:"",genre:"",releaseDate:"",
      last_modified:"0",rating:0,rating_5based:0,
      backdrop_path:r.backdrop_url?[r.backdrop_url]:[],youtube_trailer:"",episode_run_time:"",
      category_id:r.category_id?String(r.category_id):"0",year:null
    })));
  }
  if(action==="get_series_info"){
    const externalId=Number(url.searchParams.get("series_id")||0);const info:any=await releaseSeriesInfo(externalId);
    if(!info)return json({error:"not_found"},404);
    const ids=await customerVodIds(base,u,p,"get_series");if(!ids)return json({error:"entitlement_unavailable"},502);
    if(!ids.has(Number(info.provider_item_id)))return json({error:"not_allowed"},403);
    const {provider_item_id,...publicInfo}=info;
    // Lounge Android's pinned OwnTV parser accepts the documented flat-array
    // variant reliably. Keep the standard season-keyed object for third-party
    // Xtream clients so this app-specific compatibility fix cannot regress them.
    if(loungeAndroidRequest(req) && publicInfo?.episodes && !Array.isArray(publicInfo.episodes)){
      const flat:any[]=[];
      for(const [seasonKey,rows] of Object.entries(publicInfo.episodes as Record<string,unknown>)){
        if(!Array.isArray(rows))continue;
        const seasonNumber=Number(seasonKey)||0;
        for(const raw of rows){
          if(!raw||typeof raw!=="object")continue;
          const ep:any=raw as Record<string,unknown>;
          // Keep this response deliberately minimal. The pinned OwnTV parser only needs
          // these scalar fields to build EpisodeEntity rows. Excluding nested episode
          // metadata prevents Android JsonReader from ever encountering an unexpected
          // object while walking a flat episode list.
          flat.push({
            id:String(ep.id||""),
            episode_num:Number(ep.episode_num||0),
            title:String(ep.title||""),
            container_extension:String(ep.container_extension||"mp4"),
            season:Number(ep.season||seasonNumber||0),
            release_date:ep.release_date==null?null:String(ep.release_date)
          });
        }
      }
      return json({episodes:flat});
    }
    return json(publicInfo);
  }
  if(action==="get_short_epg"){
    const externalId=Number(url.searchParams.get("stream_id")||0);
    const n=Math.max(1,Math.min(20,Number(url.searchParams.get("limit")||6)));
    return json({epg_listings:await releaseShortEpg(base,u,p,externalId,n)});
  }
  return json([]);
  }catch(err){
    console.error("LOUNGE_DB_RECOVERY_ACTION",action,err);
    if([
      "get_vod_categories","get_vod_streams","get_vod_info",
      "get_series_categories","get_series","get_series_info"
    ].includes(action)){
      console.error("LOUNGE_CURATED_VOD_UNAVAILABLE",action);
      return json({error:"curated_catalogue_unavailable"},503);
    }
    return await staticFallbackApi(base,u,p,url,action);
  }
});
