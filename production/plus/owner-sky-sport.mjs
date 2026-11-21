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

// Trial the alternate source only for the affected account and channel.
export async function ownerSkySportSource(row, username, password, sql) {
  const current = Number(row.provider_stream_id);
  if (current !== 636918 || row.provider_name !== "BEST" || row.category !== "New Zealand") return current;
  if (!/^SKY SPORT 1$/i.test(String(row.display_name || "").trim())) return current;
  const expected = await loadDigest(sql);
  if (!expected || await plusDigest(username, password) !== expected) return current;
  return 2024778;
}
