import postgres from "npm:postgres@3.4.7";

const env = Deno.env;
const dbUrl = new URL(env.get("SUPABASE_DB_URL") || "");
const project = dbUrl.hostname.split(".")[1];
dbUrl.hostname = "aws-0-ap-southeast-2.pooler.supabase.com";
dbUrl.port = "5432";
dbUrl.username = "postgres." + project;
const sql = postgres(dbUrl.toString(), { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 5 });
const provider = (env.get("LOUNGE_BEST_BASE") || "http://line.loungeconnect247.xyz").replace(/\/+$/, "");
const responseHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

async function isOwner(username, password) {
  const bytes = new TextEncoder().encode(username + "\0" + password);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    byte => byte.toString(16).padStart(2, "0")).join("");
  const [row] = await sql`
    select decrypted_secret as digest
    from vault.decrypted_secrets
    where name = 'lounge_plus_route_account_sha256'
    limit 1
  `;
  const expected = String(row?.digest || "").trim();
  if (expected.length !== digest.length) return false;
  let mismatch = 0;
  for (let i = 0; i < digest.length; i++) mismatch |= expected.charCodeAt(i) ^ digest.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async request => {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: responseHeaders });
  const query = new URL(request.url).searchParams;
  const username = query.get("username");
  const password = query.get("password");
  if (!username || !password) return new Response(null, { status: 403, headers: responseHeaders });
  try {
    if (!await isOwner(username, password)) return new Response(null, { status: 403, headers: responseHeaders });
  } catch {
    return new Response(null, { status: 503, headers: responseHeaders });
  }

  const base = provider + "/live/" + encodeURIComponent(username) + "/" + encodeURIComponent(password) + "/";
  const lines = ["#EXTM3U"];
  function add(channel, id, label, format) {
    lines.push('#EXTINF:-1 tvg-id="SkySport' + channel + '.nz" group-title="Sky Sport Test",Sky Sport ' + channel + ' ' + label);
    lines.push(base + id + "." + format);
  }
  for (let channel = 1; channel <= 9; channel++) {
    const hd = 636917 + channel;
    add(channel, hd, "HD Backup", "ts");
    add(channel, 2024779 - channel, "FHD", "ts");
    add(channel, hd, "HD HLS", "m3u8");
    if (channel === 2 || channel === 3) add(channel, 1424319 - channel, "Regional", "ts");
  }
  return new Response(lines.join("\n") + "\n", {
    headers: { ...responseHeaders, "Content-Type": "application/x-mpegURL; charset=utf-8" },
  });
});
