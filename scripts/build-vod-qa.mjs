// Build an owner and catalogue-test-line gated QA copy of the existing gateway.
import { readFileSync, readdirSync } from "node:fs";

const entrypoint = new URL("../production/n/", import.meta.url);
const qaSlug = "lounge-vod-qa";

function replaceOnce(source, original, replacement) {
  if (source.split(original).length !== 2) throw new Error("QA build anchor changed: " + original);
  return source.replace(original, replacement);
}

function addQaGuard(source) {
  const importLine = 'import { routeLoungePlus } from "./plus-account-route.mjs";';
  source = replaceOnce(source, importLine, importLine.replace("routeLoungePlus", "routeLoungePlus, plusDigest"));
  source = replaceOnce(source, '  const marker="/n";', '  const marker="/' + qaSlug + '";');
  return replaceOnce(source, '  const parts=rest.split("/").filter(Boolean);', `  const parts=rest.split("/").filter(Boolean);
  const qaLogin=credentials(url,parts);
  if(!qaLogin.u||!qaLogin.p)return json({error:"not_allowed"},401);
  try{
    const rows=await sql\`
      select name,decrypted_secret from vault.decrypted_secrets
      where name in ('lounge_plus_route_account_sha256','lounge_best_xtream_catalogue_credentials')
    \`;
    const credentials=rows.find((row:any)=>row.name==='lounge_best_xtream_catalogue_credentials');
    const catalogue=JSON.parse(credentials?.decrypted_secret||"{}");
    const owner=rows.find((row:any)=>row.name==='lounge_plus_route_account_sha256')?.decrypted_secret;
    const digest=await plusDigest(qaLogin.u,qaLogin.p);
    const catalogueDigest=catalogue.username&&catalogue.password
      ?await plusDigest(catalogue.username,catalogue.password):null;
    if(digest!==owner?.trim()&&digest!==catalogueDigest)return json({error:"not_allowed"},401);
  }catch{return json({error:"qa_auth_unavailable"},503);}`);
}

const files = readdirSync(entrypoint).sort().map(name => {
  const content = readFileSync(new URL(name, entrypoint), "utf8");
  return { name, content: name === "index.ts" ? addQaGuard(content) : content };
});
process.stdout.write(JSON.stringify({ name: qaSlug, entrypoint_path: "index.ts", verify_jwt: false, files }));
