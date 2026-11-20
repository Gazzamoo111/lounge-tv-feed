import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {stripTypeScriptTypes} from "node:module";

test("fresh link uses active assigned BEST service and rechecks playback entitlement",async()=>{
 const mod=new URL("./customer-playlist-link/",import.meta.url);
 const epg=JSON.parse(await readFile(new URL("direct-epg.json",mod)));
 const [channel,[oldId,newId]]=Object.entries(epg.map)[0];
 const base="https://liqocisegeqzbyuqloql.supabase.co";
 const route=base+"/functions/v1/lounge-customer-playlist-qa";
 const core=base+"/functions/v1/n";
 const provider="https://test-provider.invalid";
 const admin="00000000-0000-4000-8000-000000000001";
 const service="00000000-0000-4000-8000-000000000002";
 const providerId="00000000-0000-4000-8000-000000000003";
 let handler, state="active", liveStatus=302, tokenHash;
 const env={SUPABASE_URL:base,SUPABASE_SERVICE_ROLE_KEY:"fixture-admin",SUPABASE_DB_URL:"postgres://u:p@db.fixture.invalid/postgres",LOUNGE_CUSTOMER_DIRECT_EPG_QA:"1"};
 globalThis.Deno={env:{get:(key)=>env[key]},serve:(fn)=>{handler=fn;}};
 globalThis.fixturePostgres=()=>async(parts,...values)=>{
  const query=parts.join("?");
  if(query.includes("admin_users")) return [{role:"admin"}];
  if(query.includes("get_provider_credentials_for_account")){
   assert.equal(values[0],providerId);
   return [{server_url:provider,provider_username:"fixture-qa",provider_password:"fixture-pass"}];
  }
  if(query.includes("insert into")){
   tokenHash=values[2];return [{id:"fixture-link",expires_at:"2027-01-01T00:00:00Z"}];
  }
  if(query.includes("update lounge_delivery")){state="revoked";return [{id:"fixture-link"}];}
  if(query.includes("service_assignments")){
   assert.match(query,/join lateral/);
   assert.match(query,/sa\.expires_at>now\(\)/);
   assert.match(query,/s\.current_period_end>now\(\)/);
   assert.match(query,/pa\.expires_at>now\(\)/);
   if(query.includes("l.token_hash")){
    assert.match(query,/l\.revoked_at is null/);
    assert.match(query,/l\.expires_at>now\(\)/);
    assert.equal(values[0],tokenHash);
   }
   return state==="active"?[{provider_account_id:providerId}]:[];
  }
  assert.fail("Unexpected fixture query");
 };
 globalThis.fetch=async(input,opts)=>{
  const url=new URL(input);
  if(url.pathname==="/auth/v1/user")return Response.json({id:admin});
  assert.equal(url.searchParams.get("username"),"fixture-qa");
  assert.equal(url.searchParams.get("password"),"fixture-pass");
  if(url.href.startsWith(core+"/get.php")){
   const license=base+"/functions/v1/tvnz-license-qa";
   return new Response([
    '#EXTM3U',
    `#EXTINF:-1 channel-id="${channel}" tvg-id="${oldId}" group-title="Sports &amp; News",Match`,
    core+"/live/fixture-qa/fixture-pass/42.ts",
    ...[1,2].flatMap(n=>[
      `#EXTINF:-1 group-title="NZ",TVNZ ${n}`,
      "#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha",
      "#KODIPROP:inputstream.adaptive.license_key="+license+"?ch="+n,
      `https://i.mjh.nz/.r/tvnz-${n}.mpd`]),
   ].join("\n")+"\n");
  }
  if(url.href.startsWith(core+"/xmltv.php"))return new Response('<tv/>');
  assert.equal(opts.redirect,"manual");
  assert.equal(url.pathname,"/functions/v1/n/live/fixture-qa/fixture-pass/42.ts");
  if(liveStatus!==302)return new Response(null,{status:liveStatus});
  return Response.redirect(provider+"/live/fixture-qa/fixture-pass/102.ts");
 };
 let source=await readFile(new URL("index.ts",mod),"utf8");
 source=source.replace('import postgres from "npm:postgres@3.4.7";',"const postgres=globalThis.fixturePostgres;")
  .replace(/"\.\/(link-core\.mjs|direct-epg\.json)"/g,(_,name)=>JSON.stringify(new URL(name,mod).href));
 await import("data:text/javascript;base64,"+Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
 const post=(path,body)=>handler(new Request(route+"/admin/"+path,{method:"POST",
  headers:{Authorization:"Bearer fixture.admin"},body:JSON.stringify(body)}));
 const issued=await post("issue",{service_assignment_id:service});
 assert.equal(issued.status,201);
 const link=await issued.json();
 assert.deepEqual(link.guide_urls.slice(1),epg.guides);
 const playlist=await handler(new Request(link.url));
 assert.equal(playlist.status,200);
 const body=await playlist.text();
 assert.ok(body.includes(`tvg-id="${newId}" group-title="Sports & News"`));
 assert.ok(!body.includes("fixture-pass"));
 const live=body.split("\n").find(line=>line.includes("/live/"));
 assert.equal((await handler(new Request(link.guide_urls[0]))).status,200);
 assert.equal((await handler(new Request(live))).status,302);
 liveStatus=422;
 assert.equal((await handler(new Request(live))).status,422);
 for(const block of ["expired-service","expired-subscription","expired-provider","expired-token"]){
  state=block;
  assert.equal((await handler(new Request(link.url))).status,401);
  assert.equal((await handler(new Request(link.guide_urls[0]))).status,401);
  assert.equal((await handler(new Request(live))).status,401);
 }
 state="active";
 assert.equal((await handler(new Request(link.url))).status,200,"same link supports renewal");
 assert.equal((await post("revoke",{link_id:service})).status,200);
 assert.equal((await handler(new Request(live))).status,401);
});
