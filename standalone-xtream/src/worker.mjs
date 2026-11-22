// Lounge TV's independent Xtream-compatible Live TV control plane.
// No Supabase, no shared provider credentials, no media byte proxying.
const js = (body, status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'}});
const problem = (message,status=400) => js({error:message},status);
const enc=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
function b64(b){return Uint8Array.from(atob(b),x=>x.charCodeAt(0));}
async function digest(pepper,user,pass){
  const key=await crypto.subtle.importKey('raw',enc.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,enc.encode(`${user}\0${pass}`)));
}
async function auth(url,env,override){
  if(!env.DB || !env.AUTH_PEPPER)return null;
  const u=override?.username ?? url.searchParams.get('username');
  const p=override?.password ?? url.searchParams.get('password');
  if(!u||!p||u.length>128||p.length>256)return null;
  const mac=await digest(env.AUTH_PEPPER,u,p);
  const row=await env.DB.prepare('SELECT username, auth_digest, expires_at, max_connections, provider_iv, provider_cipher FROM accounts WHERE username = ? AND auth_digest = ? AND enabled = 1').bind(u,mac).first();
  if(!row)return null;
  if(Number(row.expires_at)<=Math.floor(Date.now()/1000))return null;
  return {row, username:u,password:p};
}
async function providerCredentials(row,env){
  if(!env.PROVIDER_AES_KEY_BASE64)throw Error('provider credentials key missing');
  const keyBytes=b64(env.PROVIDER_AES_KEY_BASE64);
  if(keyBytes.length!==32)throw Error('invalid key length');
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['decrypt']);
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(row.provider_iv)},key,b64(row.provider_cipher));
  const creds=JSON.parse(new TextDecoder().decode(raw));
  if(!/^[A-Za-z0-9._~-]{1,128}$/.test(creds.username)||!/^[A-Za-z0-9._~-]{1,128}$/.test(creds.password))throw Error('invalid provider credentials');
  return creds;
}
const bytesResponse=(obj,kind='application/json; charset=utf-8')=>new Response(obj.body,{status:200,headers:{'Content-Type':kind,'Cache-Control':'private, max-age=180','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'}});
async function asset(env,path){
  // A tiny pointer activates a complete immutable snapshot atomically after uploads validate.
  const pointer=await env.ASSETS.get('current.json');
  if(!pointer)return null;
  const {release, epg_release}=JSON.parse(await pointer.text());
  const active = path.startsWith('epg/') ? epg_release ?? release : release;
  if(typeof active!=='string'||!/^v[a-zA-Z0-9_-]{1,48}$/.test(active))return null;
  return await env.ASSETS.get(`releases/${active}/${path}`);
}
function info(account,url){
  const domain=url.hostname;const now=Math.floor(Date.now()/1000);
  return {user_info:{username:account.username,password:account.password,message:'Lounge TV',auth:1,status:'Active',exp_date:String(account.row.expires_at),is_trial:'0',active_cons:'0',created_at:'0',max_connections:String(account.row.max_connections||1),allowed_output_formats:['ts','m3u8']},server_info:{url:domain,port:'443',https_port:'443',server_protocol:'https',rtmp_port:'0',timezone:'Pacific/Auckland',timestamp_now:now,time_now:new Date(now*1000).toISOString().replace('T',' ').slice(0,19)}};
}
async function liveAction(url,account,env){
  const action=url.searchParams.get('action')||'';
  if(!action)return js(info(account,url));
  if(action==='get_live_categories'){
    const x=await asset(env,'catalog/live_categories.json');return x?bytesResponse(x):problem('catalogue_not_ready',503);
  }
  if(action==='get_live_streams'){
    const category=url.searchParams.get('category_id');
    if(category&&!/^\d{1,5}$/.test(category))return problem('invalid_category');
    const x=await asset(env,category?`catalog/by-category/${category}.json`:'catalog/live_all.json');
    return x?bytesResponse(x):js(category?[]:{error:'catalogue_not_ready'},category?200:503);
  }
  if(['get_short_epg','get_simple_data_table'].includes(action)){
    const id=url.searchParams.get('stream_id')||'';
    if(!/^\d{1,12}$/.test(id))return js({epg_listings:[]});
    const x=await asset(env,`epg/short/${id}.json`);
    if (!x) return js({epg_listings:[]});
    const encoding = x.httpMetadata?.contentEncoding;
    const body = encoding === 'gzip' ? x.body.pipeThrough(new DecompressionStream('gzip')) : x.body;
    const {epg_listings} = await new Response(body).json();
    const now = Math.floor(Date.now() / 1000);
    const limit = Number(url.searchParams.get('limit'));
    const listings = epg_listings.filter(row => row.stop_timestamp > now);
    if (action === 'get_short_epg' && Number.isInteger(limit) && limit > 0) {
      listings.length = Math.min(listings.length, limit);
    }
    for (const row of listings) row.now_playing = Number(row.start_timestamp <= now);
    return js({epg_listings:listings});
  }
  if(['get_vod_categories','get_vod_streams','get_series_categories','get_series','get_live_info'].includes(action))return js([]);
  if(['get_vod_info','get_series_info'].includes(action))return js({});
  return problem('unsupported_action',400);
}
async function xmltv(request,env){
  const x=await asset(env,'epg/guide.xml.gz');
  if(!x)return problem('epg_not_ready',503);
  const headers = {
    'Content-Type':'application/xml; charset=utf-8',
    'Cache-Control':'private, no-store',
    'Access-Control-Allow-Origin':'*',
    'X-Content-Type-Options':'nosniff',
    'Vary':'Accept-Encoding',
  };
  // A client that accepts gzip gets the stored bytes without Worker decompression.
  const acceptsGzip = request.headers.get('Accept-Encoding')?.split(',').some(value =>
    /^\s*gzip(?:\s*;\s*q=(?:1(?:\.0+)?|0\.\d*[1-9]\d*))?\s*$/i.test(value));
  if (acceptsGzip) {
    return new Response(x.body, {
      headers:{...headers,'Content-Encoding':'gzip'},
      encodeBody:'manual',
    });
  }
  return new Response(x.body.pipeThrough(new DecompressionStream('gzip')), {headers});
}
async function m3u(url,account,env){
  const x=await asset(env,'catalog/template.m3u');if(!x)return problem('playlist_not_ready',503);
  const text=await x.text();
  // Template is sanitised at build-time; it contains no upstream credentials.
  const authUrl=`username=${encodeURIComponent(account.username)}&password=${encodeURIComponent(account.password)}`;
  const epgUrl=`${url.origin}/xmltv.php?${authUrl}`;
  const template=text.replaceAll('{{EPG_URL}}',epgUrl)
    .replaceAll('{{BASE}}',url.origin)
    .replaceAll('{{USER}}',encodeURIComponent(account.username))
    .replaceAll('{{PASS}}',encodeURIComponent(account.password));
  return new Response(template,{headers:{'Content-Type':'audio/x-mpegurl; charset=utf-8','Content-Disposition':'attachment; filename="lounge-tv.m3u"','Cache-Control':'private, no-store','Access-Control-Allow-Origin':'*'}});
}
async function redirectStream(url,env,parts){
  const [username,password,streamId]=parts;
  const account=await auth(url,env,{username:decodeURIComponent(username),password:decodeURIComponent(password)});
  if(!account)return problem('unauthorised',401);
  if(!/^\d{1,12}$/.test(streamId))return problem('unknown_stream',404);
  const match=await env.DB.prepare('SELECT stream_id FROM stream_ids WHERE stream_id = ?').bind(Number(streamId)).first();
  if(!match)return problem('unknown_stream',404);
  if(!env.UPSTREAM_ORIGIN)return problem('provider_not_configured',503);
  let upstream;try{upstream=new URL(env.UPSTREAM_ORIGIN);}catch{return problem('provider_not_configured',503)}
  if(upstream.protocol!=='https:')return problem('provider_not_configured',503);
  // Only a preconfigured upstream may receive redirects. Never accept target URLs from clients.
  const provider=await providerCredentials(account.row,env);
  upstream.pathname=`/${encodeURIComponent(provider.username)}/${encodeURIComponent(provider.password)}/${streamId}`;
  upstream.search='';upstream.hash='';
  return new Response(null,{status:302,headers:{Location:upstream.toString(),'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);const path=url.pathname;
    if(path==='/health')return js({service:'lounge-tv-xtream-standalone',status:'ok',version:'m3u-v1'});
    if(!['GET','HEAD'].includes(request.method))return problem('method_not_allowed',405);
    if(!env.DB||!env.ASSETS||!env.AUTH_PEPPER)return problem('service_not_configured',503);
    try{
      if(path.startsWith('/live/')){
        const m=path.match(/^\/live\/([^/]+)\/([^/]+)\/(\d{1,12})(?:\.(?:ts|m3u8))?$/);
        return m?await redirectStream(url,env,m.slice(1)):problem('unknown_stream',404);
      }
      if(!['/player_api.php','/xmltv.php','/get.php'].includes(path))return problem('not_found',404);
      const a=await auth(url,env);
      if(!a)return path==='/player_api.php'?js({user_info:{auth:0,status:'Disabled'}},200):problem('unauthorised',401);
      if(path==='/player_api.php')return await liveAction(url,a,env);
      if(path==='/xmltv.php')return await xmltv(request,env);
      return await m3u(url,a,env);
    }catch(err){
      // Never echo credentials, upstream URL, or sensitive D1 error details.
      return problem('temporarily_unavailable',503);
    }
  }
};
export const internal={digest,providerCredentials};
