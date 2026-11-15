// Dedicated QA hostname; no changes to the Lounge TV production gateway.
const UPSTREAM = 'https://liqocisegeqzbyuqloql.supabase.co';
const QA_HOST = 'n.loungetv.nz';
export default {
  async fetch(request) {
    const u = new URL(request.url);
    if (u.hostname !== QA_HOST) return new Response('Not found', {status:404, headers:{'Cache-Control':'no-store'}});
    const origin = new URL('/functions/v1/n'+u.pathname.replace(/\/$/,'/'), UPSTREAM);
    origin.search = u.search;
    origin.searchParams.set('_lounge_host', QA_HOST);
    const headers = new Headers(request.headers);
    headers.delete('host');
    // Never log the request URL or supplied credentials.
    try {
      const upstream = await fetch(new Request(origin, {method:request.method, headers, body:request.method==='GET'||request.method==='HEAD'?undefined:request.body,redirect:'manual'}));
      const h = new Headers(upstream.headers);
      h.set('X-Lounge-QA-Route', 'n');
      h.set('Cache-Control', 'private, no-store');
      return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:h});
    } catch {
      return new Response(JSON.stringify({error:'qa_gateway_unavailable'}),{status:502,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
  }
};