// Next.js serves the existing interface during the incremental React migration.
// API streams and HttpOnly cookies pass through the same public origin.
export async function proxy(request) {
  const upstream = new URL(process.env.API_INTERNAL_URL || 'http://127.0.0.1:3001');
  const incoming = new URL(request.url);
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  const headers = new Headers(request.headers);
  for (const name of ['host','connection','content-length','transfer-encoding','accept-encoding']) headers.delete(name);
  const options = {method:request.method, headers, redirect:'manual', cache:'no-store', signal:request.signal};
  if (!['GET','HEAD'].includes(request.method)) options.body = await request.arrayBuffer();
  try {
    const result = await fetch(upstream, options);
    const responseHeaders = new Headers(result.headers);
    for (const name of ['connection','content-length','transfer-encoding','content-encoding']) responseHeaders.delete(name);
    responseHeaders.set('Cache-Control','no-store');
    return new Response(result.body, {status:result.status, headers:responseHeaders});
  } catch (error) {
    if (request.signal.aborted) return new Response(null, {status:499});
    console.error('API gateway unavailable:', error.message);
    return Response.json({error:'Service temporarily unavailable. Please try again.'}, {status:503, headers:{'Cache-Control':'no-store'}});
  }
}
