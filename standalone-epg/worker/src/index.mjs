// Dedicated XMLTV delivery: no Xtream, account auth, streaming proxy or Supabase dependencies.
const GUIDE_PATH = '/guide.xml.gz';
function equalSecret(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
  if(x.length!==y.length||x.length===0)return false;
  let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
const privateHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive'};
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/health'){
      return new Response(JSON.stringify({service:'lounge-tv-epg',status:'ok'}),{
        headers:{'Content-Type':'application/json; charset=utf-8',...privateHeaders}
      });
    }
    if(url.pathname!==GUIDE_PATH)return new Response('Not found',{status:404,headers:privateHeaders});
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...privateHeaders,Allow:'GET, HEAD'}});
    if(!env.EPG_BUCKET||!env.EPG_READ_TOKEN)return new Response('Guide unavailable',{status:503,headers:privateHeaders});
    if(!equalSecret(url.searchParams.get('key'),env.EPG_READ_TOKEN))return new Response('Not found',{status:404,headers:privateHeaders});
    try {
      const object=await env.EPG_BUCKET.get(env.GUIDE_OBJECT_KEY||'guides/current.xml.gz');
      if(!object)return new Response('Guide unavailable',{status:503,headers:privateHeaders});
      const headers=new Headers({'Content-Type':'application/gzip','Content-Disposition':'inline; filename="guide.xml.gz"',
        'Cache-Control':'private, max-age=900','X-Content-Type-Options':'nosniff',
        'X-Robots-Tag':'noindex, nofollow, noarchive'});
      if(object.httpEtag)headers.set('ETag',object.httpEtag);
      if(Number.isFinite(object.size))headers.set('Content-Length',String(object.size));
      if(request.headers.get('If-None-Match')===object.httpEtag){
        headers.delete('Content-Length');return new Response(null,{status:304,headers});
      }
      return new Response(request.method==='HEAD'?null:object.body,{status:200,headers});
    }catch(_e){
      return new Response('Guide unavailable',{status:503,headers:privateHeaders});
    }
  }
};
