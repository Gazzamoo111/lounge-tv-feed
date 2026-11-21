let cache={until:0,digest:""};

async function plusDigest(username,password){
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

const previousSources = new Map([
  [2, 1424317], [3, 1424316], [4, 2024775], [5, 2024774],
  [6, 2024773], [7, 2024772], [8, 2024771],
]);

// Use the HD TS alternative only for the owner and the known affected routes.
export async function ownerSkyHdSource(row, username, password, sql) {
  const current = Number(row.provider_stream_id);
  if (row.provider_name !== "BEST" || row.category !== "New Zealand") return current;
  const match = /^SKY SPORT ([2-8])$/i.exec(String(row.display_name || "").trim());
  if (!match) return current;
  const channel = Number(match[1]);
  if (previousSources.get(channel) !== current) return current;
  const expected = await loadDigest(sql);
  if (!expected || await plusDigest(username, password) !== expected) return current;
  return 636917 + channel;
}
