
import { createClient } from "npm:@supabase/supabase-js@2.75.0";
import { adminHtml } from "./admin.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const db = createClient(URL_BASE, SERVICE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"authorization,content-type,apikey","X-Content-Type-Options":"nosniff","Cache-Control":"no-store"};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{...cors,"Content-Type":"application/json;charset=utf-8"}});
const safe=(v:unknown,max=200)=>String(v??"").trim().slice(0,max);
const sha=async (s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const validUrl=(s:string)=>{try{let u=new URL(s);return u.protocol==="http:"||u.protocol==="https:"}catch{return false}};
function modifyExtinf(line:string, name:string, group:string) {
  let out=line.startsWith("#EXTINF:")?line:'#EXTINF:-1';
  const comma=out.lastIndexOf(",");
  out=(comma>=0?out.slice(0,comma):out)+","+name.replace(/[\r\n]/g," ");
  if(/group-title="[^"]*"/i.test(out))out=out.replace(/group-title="[^"]*"/i,'group-title="'+group.replace(/"/g,"'")+'"');
  else out=out.replace(/^#EXTINF:(-?\d+)/,'#EXTINF:$1 group-title="'+group.replace(/"/g,"'")+'"');
  return out;
}

async function bestCredentials() {
  // Test account only. Never return its credentials through JSON admin endpoints.
  const {data:account,error:ae}=await db.from("provider_accounts").select("id,status").eq("label","BEST Launch Test").limit(1).maybeSingle();
  if(ae||!account)return null;
  const {data,error}=await db.rpc("get_provider_credentials_for_account",{p_provider_account_id:account.id});
  if(error||!Array.isArray(data)||!data.length)return null;
  const c=data[0] as {server_url:string,provider_username:string,provider_password:string};
  if(!validUrl(c.server_url)||!c.provider_username||!c.provider_password)return null;
  return {
    host:c.server_url.replace(/\/+(get\.php|player_api\.php)?$/i,"").replace(/\/+$/,""),
    username:c.provider_username,
    password:c.provider_password
  };
}
function bestStreamUrl(c:{host:string,username:string,password:string}, id:number|string){
  if(!/^\d+$/.test(String(id)))return "";
  return c.host+"/live/"+encodeURIComponent(c.username)+"/"+encodeURIComponent(c.password)+"/"+id+".ts";
}
function derivedExtinf(c:any,group:string) {
  const attrs=[
    c.tvg_id?'tvg-id="'+String(c.tvg_id).replace(/"/g,"'")+'"':"",
    c.artwork_url?'tvg-logo="'+String(c.artwork_url).replace(/"/g,"'")+'"':"",
    'group-title="'+group.replace(/"/g,"'")+'"'
  ].filter(Boolean).join(" ");
  return "#EXTINF:-1 "+attrs+","+(c.display_name||c.original_name);
}
async function playlist(req:Request, url:URL) {
  const token=url.searchParams.get("token")||"";
  if(token.length<40||token.length>100)return new Response("Not found",{status:404});
  const {data:setting,error:se}=await db.from("lounge_curator_settings").select("playlist_token_hash,published").eq("id",1).single();
  if(se||!setting?.published||!setting.playlist_token_hash||await sha(token)!==setting.playlist_token_hash)
    return new Response("Not found",{status:404});
  const {data:groups,error:ge}=await db.from("lounge_curator_groups").select("group_name,enabled,custom_name").limit(2000);
  if(ge)return new Response("Unavailable",{status:503});
  const settings=new Map((groups||[]).map((g:any)=>[g.group_name,g]));
  const best=await bestCredentials();
  const output=['#EXTM3U x-tvg-url="https://i.mjh.nz/nz/epg.xml.gz"'];
  for(let offset=0;offset<50000;offset+=750) {
    const {data,error}=await db.from("lounge_curator_channels")
      .select("source,provider_stream_id,present,original_name,original_group,display_name,display_group,extinf_line,extra_lines,stream_url,tvg_id,artwork_url")
      .eq("status","visible").eq("present",true)
      .order("sort_order",{ascending:true}).order("id",{ascending:true})
      .range(offset,offset+749);
    if(error)return new Response("Unavailable",{status:503});
    for(const c of data||[]) {
      const stream=c.stream_url||(best&&c.source==="best"&&c.provider_stream_id?bestStreamUrl(best,c.provider_stream_id):"");
      if(!stream||!validUrl(stream))continue;
      const group=c.display_group||c.original_group||"Other";
      const config:any=settings.get(group);
      if(config?.enabled===false)continue;
      const visibleGroup=config?.custom_name||group;
      const info=c.extinf_line?modifyExtinf(c.extinf_line,c.display_name||c.original_name,visibleGroup):derivedExtinf(c,visibleGroup);
      output.push(info);
      if(c.extra_lines)for(const line of c.extra_lines.split("\n"))if(/^#(?:KODIPROP|EXTVLCOPT|EXTGRP|EXTHTTP|EXT-X-)/.test(line))output.push(line);
      output.push(stream);
    }
    if(!data||data.length<750)break;
  }
  return new Response(output.join("\n")+"\n",{
    headers:{"Content-Type":"audio/x-mpegurl;charset=utf-8","Cache-Control":"private,no-store,max-age=0","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Disposition":"inline; filename=LoungeTV.m3u"}
  });
}
async function requireAdmin(req:Request) {
  const authorization=req.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))return null;
  const {data,error}=await db.auth.getUser(authorization.slice(7));
  if(error||!data?.user?.id)return null;
  const {data:member}=await db.from("admin_users").select("role").eq("user_id",data.user.id).maybeSingle();
  if(!member||!["owner","admin"].includes(member.role))return null;
  return data.user.id;
}
const sourceCategory=(name:string,group:string)=>/sky\s*sports?/i.test(name)&&/\bnz\b|new zealand/i.test(group+" "+name)?"Sky Sport NZ":group||"Other";
function initialExclusion(name:string, group:string, source:string) {
  if(source!=="best")return null;
  const both=(name+" "+group).toLowerCase();
  const foreign=/(^|[\s|:])(hindi|tamil|telugu|punjabi|urdu|arabic|spanish|portuguese|french|russian|german|italian|turkish|korean|chinese|mandarin|japanese|vietnamese|bengali|malayalam|latino)([\s|:]|$)/i;
  if(/\b(news|adult|xxx|porn|religious|religion|church|shopping|infomercial)\b/i.test(both))return "Excluded content";
  if(foreign.test(both)||/^(IN|ES|FR|DE|PT|BR|RU|TR|AR|IT|CN|JP|KR)\s*[|:]/i.test(group))return "Non-English package";
  if((/^\s*(NZ|NEW ZEALAND)\s*[|:]/i.test(group)||/^\s*NZ\s*[|:]/i.test(name))
      &&!/sky\s*sports?/i.test(name))return "BEST NZ replaced by Freeview";
  return null;
}
async function api(req:Request) {
  const actor=await requireAdmin(req);
  if(!actor)return json({error:"Admin sign-in required"},401);
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=="object")return json({error:"Invalid JSON"},400);
  const action=safe(body.action,35);
  try {
    if(action==="status") {
      const counts:any={};
      for(const s of ["visible","backup","excluded"]){
        const {count,error}=await db.from("lounge_curator_channels").select("id",{head:true,count:"exact"}).eq("status",s);
        if(error)throw error;counts[s]=count||0;
      }
      const {count:ready}=await db.from("lounge_curator_channels").select("id",{head:true,count:"exact"}).eq("status","visible").eq("present",true).or("source.eq.best,stream_url.not.is.null");
      const accountConnected=Boolean(await bestCredentials());
      const {data:config}=await db.from("lounge_curator_settings").select("published,generated_at").eq("id",1).single();
      return json({counts,ready:accountConnected?(ready||0):0,best_connected:accountConnected,published:Boolean(config?.published),generated_at:config?.generated_at||null});
    }
    if(action==="groups") {
      const {data,error}=await db.from("lounge_curator_groups").select("group_name,enabled,custom_name,sort_order")
        .order("sort_order").order("group_name").limit(2000);
      if(error)throw error;return json({groups:data||[]});
    }
    if(action==="list"){
      const limit=Math.max(1,Math.min(80,Number(body.limit)||40));
      const offset=Math.max(0,Math.min(50000,Number(body.offset)||0));
      let q=db.from("lounge_curator_channels")
       .select("id,source,provider_stream_id,original_name,original_group,display_name,display_group,status,default_reason,manual_override,present,sort_order,stream_url",{count:"exact"})
       .order("sort_order").order("original_name").range(offset,offset+limit-1);
      if(body.group)q=q.eq("display_group",safe(body.group,240));
      if(["visible","backup","excluded"].includes(body.status))q=q.eq("status",body.status);
      if(body.ready===true)q=q.or("source.eq.best,stream_url.not.is.null");
      const needle=safe(body.search,90).replace(/[%,().]/g,"");
      if(needle)q=q.or("original_name.ilike.%"+needle+"%,display_name.ilike.%"+needle+"%");
      const {data,error,count}=await q;if(error)throw error;
      return json({items:(data||[]).map(({stream_url,...rest}:any)=>({...rest,has_url:Boolean(stream_url)||rest.source==="best"})),count:count||0});
    }
    if(action==="set_channel"){
      const id=safe(body.id,110);
      if(!/^(best:\d+|freeview:[a-z0-9_-]+)$/.test(id))return json({error:"Invalid channel"},400);
      const status=safe(body.status,20);
      if(!["visible","backup","excluded"].includes(status))return json({error:"Invalid status"},400);
      const patch:any={status,manual_override:true,updated_at:new Date().toISOString()};
      if(typeof body.display_name==="string")patch.display_name=safe(body.display_name,180)||null;
      if(typeof body.display_group==="string"){
        patch.display_group=safe(body.display_group,240)||null;
        if(patch.display_group)await db.from("lounge_curator_groups").upsert({group_name:patch.display_group},{onConflict:"group_name",ignoreDuplicates:true});
      }
      const {data,error}=await db.from("lounge_curator_channels").update(patch).eq("id",id).select("id,status").single();
      if(error)throw error;return json({saved:data});
    }
    if(action==="set_group"){
      const group=safe(body.group,240);
      if(!group)return json({error:"Category required"},400);
      const patch:any={enabled:body.enabled!==false,custom_name:typeof body.custom_name==="string"?(safe(body.custom_name,130)||null):null,updated_at:new Date().toISOString()};
      const {error}=await db.from("lounge_curator_groups").update(patch).eq("group_name",group);
      if(error)throw error;return json({ok:true});
    }
    if(action==="import"){
      const entries=Array.isArray(body.entries)?body.entries:[];
      if(!entries.length||entries.length>200)return json({error:"Import batches must contain 1–200 entries"},400);
      const ids=entries.map((e:any)=>safe(e.id,110)).filter((s:string)=>/^(best:\d+|freeview:[a-z0-9_-]+)$/.test(s));
      if(!ids.length)return json({imported:0});
      const {data:existing,error:qe}=await db.from("lounge_curator_channels")
        .select("id,source,provider_stream_id,original_name,original_group,display_group,status,manual_override,default_reason,present,sort_order,display_name,tvg_id,artwork_url").in("id",ids);
      if(qe)throw qe;
      const known=new Map((existing||[]).map((x:any)=>[x.id,x]));
      const rows:any[]=[];
      for(const e of entries){
        const id=safe(e.id,110), url=safe(e.stream_url,2000);
        if(!ids.includes(id)||!validUrl(url))continue;
        const old:any=known.get(id);
        const source=id.startsWith("freeview:")?"freeview":"best";
        const name=safe(e.name,180)||old?.original_name||id;
        const group=safe(e.group,240)||old?.original_group||"Other";
        const targetGroup=old?.display_group&&!old.display_group.startsWith("BEST / ")?old.display_group:sourceCategory(name,group);
        const isFreeview=source==="freeview";
        const excluded=initialExclusion(name,group,source);
        const state=old?.manual_override?old.status:(excluded?"excluded":(old?.status||"visible"));
        rows.push({
          id,source,provider_stream_id:source==="best"?Number(id.slice(5)):null,
          original_name:old?.original_name||name,original_group:old?.original_group&&!old.original_group.startsWith("BEST / ")?old.original_group:group,
          display_group:targetGroup,display_name:old?.display_name||null,
          status:state,manual_override:old?.manual_override||false,default_reason:old?.manual_override?(old?.default_reason||null):(excluded||old?.default_reason||null),
          present:true,sort_order:old?.sort_order||1000,
          tvg_id:old?.tvg_id||safe(e.tvg_id,150)||null,artwork_url:old?.artwork_url||null,
          extinf_line:safe(e.extinf_line,2000),extra_lines:safe(e.extra_lines,4000),stream_url:url,
          updated_at:new Date().toISOString()
        });
      }
      if(!rows.length)return json({error:"No valid Live TV stream URLs"},400);
      const {error}=await db.from("lounge_curator_channels").upsert(rows,{onConflict:"id"});
      if(error)throw error;
      const groups=[...new Set(rows.map(x=>x.display_group))];
      const {error:ge}=await db.from("lounge_curator_groups").upsert(groups.map(g=>({group_name:g})),{onConflict:"group_name",ignoreDuplicates:true});
      if(ge)throw ge;
      return json({imported:rows.length});
    }

    if(action==="dedupe"){
      const {data,error}=await db.rpc("lounge_curator_hide_duplicates");
      if(error)throw error;
      return json(data||{hidden_as_backup:0});
    }
    if(action==="import_freeview"){
      const response=await fetch("https://i.mjh.nz/nz/kodi-tv.m3u8",{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error("Freeview source unavailable");
      const raw=await response.text();const lines=raw.split(/\r?\n/);
      const entries:any[]=[];let meta="";let extra:string[]=[];
      for(const v of lines){
        const line=v.trim();
        if(line.startsWith("#EXTINF:")){meta=line;extra=[];continue;}
        if(line.startsWith("#")){if(meta)extra.push(line);continue;}
        if(!meta||!validUrl(line))continue;
        const tvg=(meta.match(/(?:channel-id|tvg-id)="([^"]+)"/i)||[])[1]||"";
        if(!["mjh-tvnz-1","mjh-tvnz-2","mjh-tvnz-duke","mjh-three"].includes(tvg))continue;
        entries.push({id:"freeview:"+tvg,name:meta.slice(meta.lastIndexOf(",")+1),original_group:"NZ Freeview",display_group:"NZ Freeview",source:"freeview",status:"visible",manual_override:false,present:true,extra_lines:extra.join("\n"),extinf_line:meta,stream_url:line,tvg_id:tvg});
        meta="";
      }
      if(entries.length!==4)return json({error:"Expected TVNZ 1, TVNZ 2, DUKE and Three but found "+entries.length},502);
      const {error}=await db.from("lounge_curator_channels").upsert(entries,{onConflict:"id"});
      if(error)throw error;
      await db.from("lounge_curator_groups").upsert({group_name:"NZ Freeview"},{onConflict:"group_name",ignoreDuplicates:true});
      return json({imported:entries.length});
    }
    if(action==="generate_url") {
      const connected=Boolean(await bestCredentials());
      const {count:ready,error:ce}=await db.from("lounge_curator_channels").select("id",{head:true,count:"exact"}).eq("status","visible").eq("present",true).or(connected?"source.eq.best,stream_url.not.is.null":"stream_url.not.is.null");
      if(ce)throw ce;
      if(!ready)return json({error:"No playable entries available. Verify BEST connectivity or refresh Freeview."},400);
      const bytes=crypto.getRandomValues(new Uint8Array(32));
      const token=Array.from(bytes).map(b=>b.toString(16).padStart(2,"0")).join("");
      const {error}=await db.from("lounge_curator_settings").update({playlist_token_hash:await sha(token),published:true,generated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",1);
      if(error)throw error;
      const url=new URL(req.url);url.search="";url.searchParams.set("playlist","1");url.searchParams.set("token",token);
      return json({url:url.toString(),warning:"Keep this URL private. Regenerating it disables the previous link."});
    }
    if(action==="disable_url"){
      const {error}=await db.from("lounge_curator_settings").update({published:false}).eq("id",1);
      if(error)throw error;return json({ok:true});
    }
    return json({error:"Unknown action"},400);
  }catch(e){console.error("curator:",String((e as Error).message||e).slice(0,180));return json({error:"Unable to complete action"},503);}
}
Deno.serve(async (req:Request)=>{
  const url=new URL(req.url);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(!URL_BASE||!SERVICE_KEY)return json({error:"Configuration unavailable"},503);
  if(req.method==="GET"&&url.searchParams.get("playlist")==="1")return playlist(req,url);
  if(req.method==="GET"){
    return new Response(adminHtml.replaceAll("__SUPA_URL__",URL_BASE).replaceAll("__PUBLIC_KEY__",PUBLIC_KEY),{
      headers:{...cors,"Content-Type":"text/html;charset=utf-8","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer",
      "Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src "+URL_BASE+"; img-src data:; frame-ancestors 'none'; base-uri 'none' "}
    });
  }
  if(req.method==="POST")return api(req);
  return json({error:"Method not allowed"},405);
});
