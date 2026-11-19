import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {plusDigest,routeLoungePlus} from "./plus-account-route.mjs";
const source=readFileSync(new URL("./index.ts",import.meta.url),"utf8");
const PUB="https://n.loungetv.nz",SUPA="https://liqocisegeqzbyuqloql.supabase.co";
const u="testplususer",p="randomtestpassword";
const expected=await plusDigest(u,p);
const db={unsafe:async(sql)=>{
 assert(sql.includes("vault.decrypted_secrets"));
 assert(!sql.includes("550adaf838"));
 return [{digest:expected}];
}};
let captured;
const fetcher=async(url,init)=>{
 captured={url,init};
 return new Response(JSON.stringify({categories:[{category_name:"01 New Zealand"}]}),{
  status:200,headers:{"Content-Type":"application/json"}});
};
const req=(path)=>new Request(PUB+path);
test("production patch only adds a guarded route before legacy n handling",()=>{
 assert(source.includes('const marker="/n";'));
 assert(source.includes('const plus=await routeLoungePlus(req,url,rest,parts,sql,SUPABASE_URL);'));
 assert(source.includes('if(plus) return plus;'));
 assert(source.includes('const base=await bestBase();'));
 assert(!source.includes("testplususer"));
});
test("Plus account's standard Xtream server URL forwards to Plus under the hood",async()=>{
 const request=req("/player_api.php?action=get_live_categories&username="+u+"&password="+p);
 const response=await routeLoungePlus(request,new URL(request.url),"/player_api.php",["player_api.php"],db,SUPA,{fetcher});
 assert.equal(response.status,200);
 assert.equal(response.headers.get("x-lounge-catalogue"),"plus-qa");
 const destination=new URL(captured.url);
 assert.equal(destination.origin,SUPA);
 assert.equal(destination.pathname,"/functions/v1/lounge-plus-qa/player_api.php");
 assert.equal(destination.searchParams.get("_lounge_host"),"n.loungetv.nz");
 assert.equal(destination.searchParams.get("username"),u);
 assert.equal(destination.searchParams.get("password"),p);
 assert.equal(captured.init.redirect,"manual");
});
test("other customers and wrong credentials remain unchanged",async()=>{
 let calls=0;const guard=async()=>{calls++;throw Error("must not proxy")};
 for(const [user,pwd] of [["anothercustomer",p], [u,"wrong"],["no","password"]]){
   const request=req("/player_api.php?action=get_live_streams&username="+user+"&password="+pwd);
   const response=await routeLoungePlus(request,new URL(request.url),"/player_api.php",["player_api.php"],db,SUPA,{fetcher:guard});
   assert.equal(response,null);
 }
 assert.equal(calls,0);
});
test("movies and series remain handled by original n for every account",async()=>{
 for(const a of ["get_vod_streams","get_series","get_series_info"]){
  const request=req("/player_api.php?action="+a+"&username="+u+"&password="+p);
  assert.equal(await routeLoungePlus(request,new URL(request.url),"/player_api.php",["player_api.php"],db,SUPA,{fetcher}),null);
 }
});
test("Live M3U/guide and /live stream requests work through existing hostname",async()=>{
 const scenarios=[
  ["/get.php?username="+u+"&password="+p,"/get.php",["get.php"]],
  ["/xmltv.php?username="+u+"&password="+p,"/xmltv.php",["xmltv.php"]],
  ["/live/"+u+"/"+p+"/1900.ts","/live/"+u+"/"+p+"/1900.ts",["live",u,p,"1900.ts"]]
 ];
 for(const [path,rest,parts] of scenarios){
  const request=req(path); const result=await routeLoungePlus(request,new URL(request.url),rest,parts,db,SUPA,{fetcher});
  assert.equal(result.status,200);
  const destination=new URL(captured.url);
  assert.equal(destination.pathname,"/functions/v1/lounge-plus-qa"+rest);
  assert.equal(destination.searchParams.get("_lounge_host"),"n.loungetv.nz");
 }
});
test("Unauthenticated and unknown paths fall through to v36",async()=>{
 const request=req("/player_api.php?action=get_live_categories");
 assert.equal(await routeLoungePlus(request,new URL(request.url),"/player_api.php",["player_api.php"],db,SUPA,{fetcher}),null);
 const other=req("/not-existing?username="+u+"&password="+p);
 assert.equal(await routeLoungePlus(other,new URL(other.url),"/not-existing",["not-existing"],db,SUPA,{fetcher}),null);
});
