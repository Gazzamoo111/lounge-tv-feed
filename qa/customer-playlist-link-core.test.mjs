import test from "node:test";
import assert from "node:assert/strict";
import {rewriteLoungeM3u,TOKEN_RE} from "./customer-playlist-link/link-core.mjs";
const key="A".repeat(43);
const publicBase="https://liqocisegeqzbyuqloql.supabase.co/functions/v1/lounge-customer-playlist-qa";
const coreBase="https://liqocisegeqzbyuqloql.supabase.co/functions/v1/n";
const username="qa-only-username",password="qa-only-password";
const relay="https://liqocisegeqzbyuqloql.supabase.co/functions/v1/tvnz-license-qa";
const fixture=[
 '#EXTM3U x-tvg-url="'+coreBase+'/xmltv.php?username='+username+'&password='+password+'"',
 '#EXTINF:-1 group-title="01 New Zealand",SKY SPORT 1 HD BACKUP',
 coreBase+'/live/'+username+'/'+password+'/2000636918.ts',
 '#EXTINF:-1 group-title="01 New Zealand",TVNZ 1',
 '#EXTVLCOPT:http-user-agent=otg/1.5.1',
 '#KODIPROP:inputstream.adaptive.manifest_type=mpd',
 '#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha',
 '#KODIPROP:inputstream.adaptive.license_key='+relay+'?ch=1',
 'https://i.mjh.nz/.r/tvnz-1.mpd',
 '#EXTINF:-1 group-title="01 New Zealand",TVNZ 2',
 '#KODIPROP:inputstream.adaptive.manifest_type=mpd',
 '#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha',
 '#KODIPROP:inputstream.adaptive.license_key='+relay+'?ch=2',
 'https://i.mjh.nz/.r/tvnz-2.mpd',
 '#EXTINF:-1 group-title="01 New Zealand",Three',
 'https://i.mjh.nz/.r/three.m3u8',
].join("\n")+"\n";
const options={token:key,publicBase,coreBase,username,password};
test("token is URL-safe and exactly 32 bytes encoded",()=>{
 assert.ok(TOKEN_RE.test(key));
 assert.equal(TOKEN_RE.test("short"),false);
 assert.equal(TOKEN_RE.test(key+"/"),false);
});
test("rewrite preserves TVNZ DRM and unified BEST NZ channels, without BEST credentials",()=>{
 const {result,media,licences}=rewriteLoungeM3u(fixture,options);
 assert.equal(media,4);assert.equal(licences,2);
 assert.ok(result.startsWith('#EXTM3U x-tvg-url="'+publicBase+'/epg/'+key+'"'));
 assert.ok(result.includes(publicBase+'/live/'+key+'/2000636918.ts'));
 assert.ok(result.includes(publicBase+'/license/'+key+'/1'));
 assert.ok(result.includes(publicBase+'/license/'+key+'/2'));
 assert.ok(result.includes('https://i.mjh.nz/.r/tvnz-1.mpd'));
 assert.ok(result.includes('https://i.mjh.nz/.r/tvnz-2.mpd'));
 assert.ok(result.includes('https://i.mjh.nz/.r/three.m3u8'));
 assert.ok(!result.includes(username));assert.ok(!result.includes(password));
 assert.equal((result.match(/#EXTINF:/g)||[]).length,4);
});
test("reject unknown external media hosts",()=>{
 assert.throws(()=>rewriteLoungeM3u(fixture.replace("https://i.mjh.nz/.r/three.m3u8","https://attacker.invalid/three.m3u8"),options),/external stream/);
});
test("reject mismatched BEST credentials",()=>{
 assert.throws(()=>rewriteLoungeM3u(fixture.replace("/"+username+"/"+password+"/","/"+username+"/wrong-password/"),options),/Unexpected Lounge stream/);
});
test("reject unrecognised DRM licence targets",()=>{
 assert.throws(()=>rewriteLoungeM3u(fixture.replace(relay+"?ch=1","https://attacker.invalid/wv"),options),/Unexpected licence source/);
});
test("reject missing TVNZ licence, prevent silent unprotected rollout",()=>{
 assert.throws(()=>rewriteLoungeM3u(fixture.replace("#KODIPROP:inputstream.adaptive.license_key="+relay+"?ch=2\n",""),options),/Incomplete protected/);
});
test("reject unencrypted source and public base",()=>{
 assert.throws(()=>rewriteLoungeM3u(fixture,{...options,publicBase:"http://example.com"}),/HTTPS required/);
});
test("reject wrong link token",()=>{
 assert.throws(()=>rewriteLoungeM3u(fixture,{...options,token:"garbage"}),/Invalid recipient/);
});
test("fixes category ampersands only and checks the original guide ID before mapping",()=>{
 const line='#EXTINF:-1 channel-id="ltv-42" tvg-id="original&amp;id" tvg-logo="https://example.com/?a=1&amp;b=2" group-title="01 Sports &amp; News, &quot;NZ&quot;",Name &amp; co';
 const enriched=fixture.replace('#EXTINF:-1 group-title="01 New Zealand",SKY SPORT 1 HD BACKUP',line);
 const opt={...options,epgMap:{"ltv-42":["original&id","source&id"]}};
 const result=rewriteLoungeM3u(enriched,opt).result;
 assert.ok(result.includes(line.replace('group-title="01 Sports &amp; News','group-title="01 Sports & News').replace('tvg-id="original&amp;id"','tvg-id="source&amp;id"')));
 assert.ok(result.includes(publicBase+'/live/'+key+'/2000636918.ts'));
 assert.ok(rewriteLoungeM3u(enriched.replace('original&amp;id','changed'),opt).result.includes('tvg-id="changed"'));
 assert.ok(rewriteLoungeM3u(enriched,options).result.includes('tvg-id="original&amp;id"'));
});

test("leaves non-display lines and both protected DRM paths unchanged with the map enabled",()=>{
 const baseline=rewriteLoungeM3u(fixture,options).result;
 const mapped=rewriteLoungeM3u(fixture,{...options,epgMap:{"ltv-42":["old","new"]}}).result;
 assert.equal(mapped,baseline);
});
