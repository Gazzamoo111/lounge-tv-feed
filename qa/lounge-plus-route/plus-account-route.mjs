/**
 * Account-scoped route for Lounge TV Plus QA.
 * SHA-256 credential verifier resides in Supabase Vault, never in source.
 * Only Live TV, guide and Xtream login routes change for this account.
 * Everyone else, and all VOD requests, retain the original n v36 behaviour.
 */
const PLUS_PATH="/functions/v1/lounge-plus-qa";
const PLUS_HOST="n.loungetv.nz";
let cache={until:0,digest:""};

function relevant(parts,action) {
 const type=String(parts[0]||"");
 if(["get.php","xmltv.php","live","sport"].includes(type))return true;
 if(type==="player_api.php"||type===""){
   return !action||["get_live_categories","get_live_streams","get_short_epg"].includes(action);
 }
 return false;
}

export async function plusDigest(username,password){
 const value=new TextEncoder().encode(String(username)+"\0"+String(password));
 const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",value));
 return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}

async function loadDigest(sql) {
 if(cache.until>Date.now())return cache.digest;
 try {
  const rows=await sql.unsafe("SELECT decrypted_secret AS digest FROM vault.decrypted_secrets WHERE name='lounge_plus_route_account_sha256' LIMIT 1");
  const digest=String(rows[0]?.digest||"").trim();
  if(!/^[a-f0-9]{64}$/.test(digest))return "";
  cache={until:Date.now()+5*60*1000,digest};
  return digest;
 }catch{
  return "";
 }
}

/**
 * Returns null for every other account, preserving unmodified n v36 flow.
 */
export async function routeLoungePlus(req,url,rest,parts,sql,supabaseUrl,options={}) {
 const action=url.searchParams.get("action");
 if(!relevant(parts,action))return null;
 const resource=String(parts[0]||"");
 const pathCreds=["live","sport"].includes(resource);
 const username=url.searchParams.get("username")||(pathCreds?String(parts[1]||""):"");
 const password=url.searchParams.get("password")||(pathCreds?String(parts[2]||""):"");
 if(!username||!password)return null;
 const expected=await loadDigest(sql);
 if(!expected||await plusDigest(username,password)!==expected)return null;

 const target=new URL(supabaseUrl+PLUS_PATH+rest);
 for(const [key,value] of url.searchParams){
  if(key!=="_lounge_host")target.searchParams.append(key,value);
 }
 target.searchParams.set("_lounge_host",PLUS_HOST);

 const headers=new Headers(req.headers);
 headers.delete("host");
 headers.delete("content-length");
 const fetcher=options.fetcher||fetch;
 try{
  const upstream=await fetcher(target.toString(),{
   method:req.method,
   headers,
   redirect:"manual",
   body:req.method==="GET"||req.method==="HEAD"?undefined:req.body
  });
  const responseHeaders=new Headers(upstream.headers);
  responseHeaders.set("Access-Control-Allow-Origin","*");
  responseHeaders.set("X-Lounge-Catalogue","plus-qa");
  return new Response(req.method==="HEAD"?null:upstream.body,{
   status:upstream.status,statusText:upstream.statusText,headers:responseHeaders
  });
 }catch{
  return Response.json({error:"plus_catalogue_temporarily_unavailable"},{status:502,headers:{"Cache-Control":"no-store"}});
 }
}
