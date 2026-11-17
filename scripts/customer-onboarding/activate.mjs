#!/usr/bin/env node
// Single operator action AFTER verified payment and BEST service assignment.
// Never run this in CI or store output in logs.
// Required env: LOUNGE_ADMIN_ACCESS_TOKEN, LOUNGE_SERVICE_ASSIGNMENT_ID
// Optional: LOUNGE_CUSTOMER_LABEL, LOUNGE_LINK_DAYS
const BASE="https://liqocisegeqzbyuqloql.supabase.co/functions/v1/lounge-customer-playlist-qa";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sid=process.env.LOUNGE_SERVICE_ASSIGNMENT_ID||"";
const token=process.env.LOUNGE_ADMIN_ACCESS_TOKEN||"";
const label=(process.env.LOUNGE_CUSTOMER_LABEL||"Lounge TV").trim().slice(0,64);
const days=Number(process.env.LOUNGE_LINK_DAYS||"365");
const checkOnly=process.argv.includes("--check");
if(!UUID.test(sid)||!token||!Number.isInteger(days)||days<1||days>365){
 console.error("Missing/invalid environment: service assignment UUID, admin access token or link days (1-365).");
 process.exit(2);
}
async function call(action,body){
 const response=await fetch(BASE+"/admin/"+action,{
  method:"POST",
  headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
  body:JSON.stringify(body),
  signal:AbortSignal.timeout(20000)
 });
 const data=await response.json().catch(()=>({error:"Invalid gateway response"}));
 if(!response.ok)throw Error(action+": "+(data.error||"HTTP "+response.status));
 return data;
}
try{
 const readiness=await call("check",{service_assignment_id:sid});
 if(!readiness.ready){
  console.error("Not provisioned: "+readiness.reason+". No link issued.");
  process.exit(3);
 }
 if(checkOnly){
  console.log("Ready: active service, subscription, BEST account and provider credentials verified.");
  process.exit(0);
 }
 const issued=await call("issue",{service_assignment_id:sid,label,expires_in_days:days});
 if(!issued.ok||!issued.url||!issued.link_id)throw Error("Gateway did not return a complete link.");
 const welcome=[
  "Your Lounge TV access is ready.",
  "",
  "1. Install Nuvio + IPTV using the guide on loungetv.nz.",
  "2. Create or sign in to your OWN Nuvio account.",
  "3. In Settings > Live TV, choose Add M3U Playlist. Paste this private link:",
  issued.url,
  "Name the playlist Lounge TV Live.",
  "4. Enable Settings > Live TV > Setup Sync on your own devices once it works.",
  "",
  "If your package includes TorBox, link your own account or API key separately.",
  "Do not share this playlist link."
 ].join("\n");
 console.log(JSON.stringify({link_id:issued.link_id,link_expires_at:issued.expires_at,customer_message:welcome,note:"Send the message privately. No secrets or links written to disk."},null,2));
}catch(error){
 console.error(error instanceof Error?error.message:"Activation failed");
 process.exitCode=1;
}
