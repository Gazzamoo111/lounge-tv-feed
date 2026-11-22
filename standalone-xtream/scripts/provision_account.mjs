// Read account details as JSON from stdin. Do not put customer/provider credentials on CLI arguments.
// Required env: AUTH_PEPPER, PROVIDER_AES_KEY_BASE64. Output is encrypted SQL for Wrangler D1.
import {createHmac,randomBytes,createCipheriv} from 'node:crypto';
const parts=[];for await(const p of process.stdin)parts.push(p);
const details=JSON.parse(Buffer.concat(parts).toString('utf8'));
const {username,password,provider_username,provider_password,expires_at,max_connections=1}=details;
if(![username,password,provider_username,provider_password].every(x=>typeof x==='string'&&x.length>0))throw Error('Missing credentials');
if(!/^[A-Za-z0-9._~-]{1,128}$/.test(username))throw Error('Invalid customer username');
if(![provider_username,provider_password].every(x=>/^[A-Za-z0-9._~-]{1,128}$/.test(x)))throw Error('Unsupported provider credential format');
if(!Number.isSafeInteger(expires_at)||expires_at<Math.floor(Date.now()/1000))throw Error('Invalid future expiry timestamp');
if(!process.env.AUTH_PEPPER||!process.env.PROVIDER_AES_KEY_BASE64)throw Error('Secrets missing');
const key=Buffer.from(process.env.PROVIDER_AES_KEY_BASE64,'base64');if(key.length!==32)throw Error('Invalid AES key');
const mac=createHmac('sha256',process.env.AUTH_PEPPER).update(username+'\0'+password).digest('hex');
const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
const payload=Buffer.from(JSON.stringify({username:provider_username,password:provider_password}));
const encrypted=Buffer.concat([cipher.update(payload),cipher.final(),cipher.getAuthTag()]).toString('base64');
const sqlq=x=>"'"+String(x).replaceAll("'","''")+"'";
console.log(`INSERT INTO accounts(username,auth_digest,enabled,expires_at,max_connections,provider_iv,provider_cipher) VALUES (${sqlq(username)},${sqlq(mac)},1,${expires_at},${Math.max(1,Math.min(10,Number(max_connections)||1))},${sqlq(iv.toString('base64'))},${sqlq(encrypted)}) ON CONFLICT(username) DO UPDATE SET auth_digest=excluded.auth_digest,enabled=1,expires_at=excluded.expires_at,max_connections=excluded.max_connections,provider_iv=excluded.provider_iv,provider_cipher=excluded.provider_cipher,updated_at=unixepoch();`);
