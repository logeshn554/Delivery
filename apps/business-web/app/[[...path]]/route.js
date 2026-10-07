export function GET(request) {
  const origin = process.env.CUSTOMER_WEB_ORIGIN || 'http://localhost:3000';
  const path = new URL(request.url).pathname;
  const destination = path === '/signup' ? '/signup' : path === '/login' ? '/login' : '/business';
  return Response.redirect(new URL(destination, origin), 307);
}
export const dynamic = 'force-dynamic';
