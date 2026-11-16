// QA-only, pure playlist rewriting. A customer receives a bearer link, never
// a BEST username/password in playlist contents.
export const TOKEN_RE=/^[A-Za-z0-9_-]{43}$/;
const MEDIA_RE=/^(tvnz-1|tvnz-2|three|maori-tv|te-reo)\.(mpd|m3u8)$/;
const ID_RE=/^[1-9][0-9]{0,11}\.(ts|m3u8)$/;

export function rewriteLoungeM3u(source,{token,publicBase,coreBase,username,password}){
  if(!TOKEN_RE.test(token)||!username||!password)throw new Error("Invalid recipient");
  const pub=new URL(publicBase);
  const core=new URL(coreBase);
  if(pub.protocol!=="https:"||core.protocol!=="https:")throw new Error("HTTPS required");
  if(!source.startsWith("#EXTM3U")||source.length<100)throw new Error("Invalid source M3U");
  const prefix=core.pathname.replace(/\/+$/,"")+"/live/";
  const base=publicBase.replace(/\/+$/,"");
  const lines=source.replace(/\r/g,"").split("\n"),out=[];
  let media=0,licences=0,header=0;
  for(const original of lines){
    const line=original.trim();
    if(!line)continue;
    if(line.startsWith("#EXTM3U")){
      if(header++)throw new Error("Multiple headers");
      out.push('#EXTM3U x-tvg-url="'+base+'/epg/'+token+'"');
      continue;
    }
    if(line.startsWith("#KODIPROP:inputstream.adaptive.license_key=")){
      const src=line.slice("#KODIPROP:inputstream.adaptive.license_key=".length);
      const u=new URL(src);
      if(u.protocol!=="https:"||u.hostname!=="liqocisegeqzbyuqloql.supabase.co"||
         u.pathname!=="/functions/v1/tvnz-license-qa"||!["1","2"].includes(u.searchParams.get("ch"))||
         [...u.searchParams.keys()].some(k=>k!=="ch"))
        throw new Error("Unexpected licence source");
      out.push("#KODIPROP:inputstream.adaptive.license_key="+base+"/license/"+token+"/"+u.searchParams.get("ch"));
      licences++;
      continue;
    }
    if(line.startsWith("#")){
      out.push(original);
      continue;
    }
    const u=new URL(line);
    if(u.protocol!=="https:")throw new Error("Untrusted media protocol");
    if(u.origin===core.origin && u.pathname.startsWith(prefix)){
      const parts=u.pathname.slice(prefix.length).split("/");
      if(parts.length!==3||decodeURIComponent(parts[0])!==username||
         decodeURIComponent(parts[1])!==password||!ID_RE.test(parts[2])||
         u.search||u.hash)throw new Error("Unexpected Lounge stream link");
      out.push(base+"/live/"+token+"/"+parts[2]);
      media++;
      continue;
    }
    if(u.hostname==="i.mjh.nz" && u.protocol==="https:" && u.pathname.startsWith("/.r/") &&
       MEDIA_RE.test(u.pathname.slice(4)) && !u.search && !u.hash){
      out.push(u.toString());
      media++;
      continue;
    }
    throw new Error("Unexpected external stream");
  }
  if(header!==1||media<2||licences!==2)throw new Error("Incomplete protected NZ catalogue");
  const result=out.join("\n")+"\n";
  if(result.includes(encodeURIComponent(username)+"/"+encodeURIComponent(password))||
     result.includes("password="+encodeURIComponent(password)))throw new Error("Credential leak");
  return {result,media,licences};
}
