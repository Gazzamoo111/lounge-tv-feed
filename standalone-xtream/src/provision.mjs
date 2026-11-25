// Owner-only create-account interface. No third-party scripts, cookies or browser storage.
const route='/operator/provision';
const encoder=new TextEncoder();
const safe=/^[A-Za-z0-9._~-]{1,128}$/;
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"};
const response=(body,status=200,type='application/json; charset=utf-8')=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{...headers,'Content-Type':type}});
const fail=(error,status)=>response({error},status);
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
async function tokenMatches(actual,expected){
  if(typeof expected!=='string'||!(/^[A-Za-z0-9_-]{43,128}$/).test(expected)||!actual||actual.length>140)return false;
  const a=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(actual)));
  const b=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode('Bearer '+expected)));
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
async function boundedJson(request){
  const reader=request.body?.getReader();if(!reader)throw Error('body');
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw Error('size');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
const page=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lounge TV | Customer provisioning</title><style>body{font:16px system-ui;background:#10151d;color:#f0f3f8;margin:0;padding:24px}main{max-width:520px;margin:auto}h1{font-size:28px}p{color:#b8c3d1;line-height:1.5}form{display:grid;gap:14px}label{display:grid;gap:6px}input,select,button{font:inherit;padding:12px;border-radius:8px;border:1px solid #536174;background:#192330;color:white;min-width:0}button{background:#d8eaff;color:#10151d;font-weight:700;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#192330;padding:16px;border-radius:8px}button:disabled{opacity:.5}small{color:#b8c3d1}details{padding:12px;border:1px solid #536174;border-radius:8px}</style><main><h1>Register a customer</h1><p>Enter an already authorised provider line. Create a separate Lounge TV login without modifying existing accounts.</p><form id="create" autocomplete="off"><label>Operator access token<input id="token" type="password" required autocomplete="off" minlength="43"></label><label>Provider username<input id="providerUser" required autocomplete="off" maxlength="128"></label><label>Provider password<input id="providerPass" type="password" required autocomplete="off" maxlength="128"></label><label>Provider expiry (local date and time)<input id="expiry" type="datetime-local" required><small>Do not grant access beyond the paid provider expiry.</small></label><label>Live TV connections<select id="connections"><option value="1">1</option><option value="2">2</option></select></label><button id="submit" type="submit">Create customer login</button></form><p id="status" role="status"></p><section id="result" hidden><h2>Customer login</h2><pre id="credentials"></pre><button id="copy">Copy login</button><p>Send privately. Confirm playback and record renewal in your existing ledger.</p></section></main><script src="/operator/provision.js"></script></html>`;
const script=`const el=id=>document.getElementById(id);
const randomHex=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),v=>v.toString(16).padStart(2,'0')).join('');
let latest='';
el('create').addEventListener('submit',async event=>{
 event.preventDefault();el('submit').disabled=true;el('result').hidden=true;latest='';el('credentials').textContent='';el('status').textContent='Registering…';
 const user='ltv_'+randomHex(8),pass=randomHex(16);
 const expiry=Math.floor(new Date(el('expiry').value).getTime()/1000);
 const data={username:user,password:pass,provider_username:el('providerUser').value.trim(),provider_password:el('providerPass').value,expires_at:expiry,max_connections:Number(el('connections').value)};
 try{
 const r=await fetch('/operator/provision',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+el('token').value.trim()},body:JSON.stringify(data),cache:'no-store',credentials:'omit',redirect:'error'});
 const out=await r.json();if(!r.ok){el('status').textContent='Registration failed: '+String(out.error||r.status)+' (attempted username: '+user+')';return;}
 latest='Server: https://tv.loungetv.nz\\nUsername: '+user+'\\nPassword: '+pass;
 el('credentials').textContent=latest;el('result').hidden=false;el('providerUser').value='';el('providerPass').value='';el('expiry').value='';el('status').textContent='Account registered. Playback still needs verification.';
 }catch{el('status').textContent='Network or response error. Check the generated username before retrying: '+user+'';}finally{el('submit').disabled=false;}
});
el('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(latest);el('status').textContent='Copied. Send privately.';}catch{el('status').textContent='Select and copy the displayed login.';}});
`;
export async function provisionRoute(request,env,digest){
 const url=new URL(request.url);
 if(url.origin!=='https://tv.loungetv.nz'||url.search)return fail('not_found',404);
 if(request.method==='GET'){
   return url.pathname===route+'.js'?response(script,200,'application/javascript; charset=utf-8'):response(page,200,'text/html; charset=utf-8');
 }
 if(request.method!=='POST'||url.pathname!==route)return fail('method_not_allowed',405);
 if(request.headers.get('Origin')!==url.origin||request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return fail('forbidden',403);
 if(!await tokenMatches(request.headers.get('Authorization'),env.PROVISION_ADMIN_TOKEN))return fail('unauthorised',401);
 if(!env.DB||!env.AUTH_PEPPER||!env.PROVIDER_AES_KEY_BASE64)return fail('service_not_configured',503);
 let d;try{d=await boundedJson(request);}catch{return fail('invalid_input',400);}
 if(!d||typeof d!=='object'||Array.isArray(d)||![d.username,d.password,d.provider_username,d.provider_password].every(v=>typeof v==='string'&&safe.test(v))||d.password.length<20||!Number.isSafeInteger(d.expires_at)||d.expires_at<=Math.floor(Date.now()/1000)||![1,2].includes(d.max_connections))return fail('invalid_input',400);
 try{
   const keyBytes=Uint8Array.from(atob(env.PROVIDER_AES_KEY_BASE64),c=>c.charCodeAt(0));if(keyBytes.length!==32)throw Error('key');
   const key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['encrypt']);
   const iv=crypto.getRandomValues(new Uint8Array(12));
   const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify({username:d.provider_username,password:d.provider_password})));
   const mac=await digest(env.AUTH_PEPPER,d.username,d.password);
   const result=await env.DB.prepare('INSERT INTO accounts(username,auth_digest,enabled,expires_at,max_connections,provider_iv,provider_cipher) VALUES (?,?,1,?,?,?,?) ON CONFLICT(username) DO NOTHING').bind(d.username,mac,d.expires_at,d.max_connections,b64(iv),b64(cipher)).run();
   if(result?.meta?.changes===0)return fail('username_exists',409);
   if(result?.success!==true||result?.meta?.changes!==1)return fail('registration_unverified',503);
   return response({created:true},201);
 }catch{return fail('registration_unverified',503);}
}
