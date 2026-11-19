/**
 * XMLTV stream filter for Lounge TV International QA.
 * No programme rows are persisted. Feed is scanned incrementally; a bounded
 * programme block is emitted only when the XMLTV ID AND channel title match
 * a selected, customer-visible channel.
 */
export function qaGuideIdentity(v){
  return String(v??"")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/^(?:[A-Z]{2,5}\s*\|\s*)+/gi,"")
    .replace(/\b(?:FHD|FULL HD|UHD|HD|SD|HEVC|H265|H264|4K|1080P|720P)\b/gi,"")
    .toLowerCase().replace(/&amp;/g,"&").replace(/&/g," and ")
    .replace(/[^a-z0-9]/g,"");
}

export function qaGuideAttr(tag,name){
  const m=new RegExp("(?:\\s|<)"+name+"\\s*=\\s*([\"'])(.*?)\\1","i").exec(tag);
  return m?.[2]||"";
}
export function qaGuideEpoch(raw){
  const m=/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-])(\d{2})(\d{2})/.exec(String(raw||""));
  if(!m)return 0;
  const n=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]);
  return n+(m[7]==="+"?-1:1)*(+m[8]*60 + +m[9])*60000;
}

export function qaGuideSelected(rows, effectiveId){
  const out=new Map();
  for(const row of rows){
    if(row.qaEpgRejected)continue;
    const id=String(effectiveId(row)||"").trim();
    const name=qaGuideIdentity(row.display_name||"");
    if(!id||!name||id.startsWith("ltv-"))continue;
    if(!out.has(id))out.set(id,new Set());
    out.get(id).add(name);
  }
  return out;
}

export function qaGuideScanChunk(state,chunk){
  state.buffer+=chunk;
  const emitted=[];
  for(;;){
    const firstChannel=state.buffer.search(/<channel(?=[\s>])/i);
    const firstProgramme=state.buffer.search(/<programme(?=[\s>])/i);
    const first=firstChannel<0?firstProgramme:firstProgramme<0?firstChannel:Math.min(firstChannel,firstProgramme);
    if(first<0){
      // Preserve any incomplete tag prefix at a chunk boundary.
      state.buffer=state.buffer.slice(-24);
      break;
    }
    if(first>0)state.buffer=state.buffer.slice(first);
    const channel=state.buffer.startsWith("<channel")||state.buffer.startsWith("<CHANNEL");
    const close=channel?"</channel>":"</programme>";
    const at=state.buffer.toLowerCase().indexOf(close);
    if(at<0){
      if(state.buffer.length>1024*1024)throw new Error("xmltv_record_oversize");
      break;
    }
    const block=state.buffer.slice(0,at+close.length);
    state.buffer=state.buffer.slice(at+close.length);
    const tag=block.slice(0,Math.max(0,block.indexOf(">"))+1);
    if(channel){
      const id=qaGuideAttr(tag,"id");
      if(state.selected.has(id)){
        const names=[...block.matchAll(/<display-name(?:\s[^>]*)?>([\s\S]*?)<\/display-name>/gi)]
          .map(x=>qaGuideIdentity(x[1]))
          .filter(Boolean);
        if(names.some(n=>state.selected.get(id).has(n))){
          state.valid.add(id);
          if(!state.shared.has(id))emitted.push(block);
        }else state.conflicting.add(id);
      }
    }else{
      const id=qaGuideAttr(tag,"channel");
      if(!state.valid.has(id)||state.shared.has(id))continue;
      const now=state.now;
      const start=qaGuideEpoch(qaGuideAttr(tag,"start"));
      const stop=qaGuideEpoch(qaGuideAttr(tag,"stop"));
      if(!start||!stop||stop<=now-3600000||start>now+7*86400000||stop<=start)continue;
      if(!/<title(?:\s[^>]*)?>[\s\S]*?<\/title>/i.test(block))continue;
      state.programmes.set(id,(state.programmes.get(id)||0)+1);
      emitted.push(block);
    }
  }
  return emitted;
}

export function qaGuideScanner(rows,effectiveId,sharedIds=[],now=Date.now()){
  return {
    selected:qaGuideSelected(rows,effectiveId),
    shared:new Set(sharedIds),
    valid:new Set(),conflicting:new Set(),programmes:new Map(),
    buffer:"",now
  };
}

export async function* qaFilteredBestXmltv(upstream,rows,effectiveId,sharedIds=[],now=Date.now()){
  const state=qaGuideScanner(rows,effectiveId,sharedIds,now);
  const decoder=new TextDecoder();
  let read=0;
  for await(const bytes of upstream){
    read+=bytes.byteLength;
    if(read>200*1024*1024)throw new Error("provider_xmltv_read_cap");
    const emitted=qaGuideScanChunk(state,decoder.decode(bytes,{stream:true}));
    for(const block of emitted)yield block+"\n";
  }
  for(const block of qaGuideScanChunk(state,decoder.decode()))yield block+"\n";
  if(state.buffer.match(/<(?:channel|programme)\b/i))throw new Error("provider_xmltv_incomplete");
}
