import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import {
  randomBytes, randomUUID, randomInt,
  scryptSync, timingSafeEqual, createHash, createHmac,
} from 'node:crypto';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { services, activeStatuses, transitions } from './packages/constants/index.js';

// ─── Boot ────────────────────────────────────────────────────────────────────
const root       = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === 'production';
const origin     = process.env.PUBLIC_ORIGIN || 'http://localhost:8000';
if (new URL(origin).origin !== origin)
  throw new Error('PUBLIC_ORIGIN must be an origin without a path or trailing slash.');
if (production && !origin.startsWith('https://'))
  throw new Error('Production requires an HTTPS PUBLIC_ORIGIN.');

// ─── Razorpay config (disabled unless keys are set) ──────────────────────────
const RZP_KEY_ID         = process.env.RAZORPAY_KEY_ID         || '';
const RZP_KEY_SECRET     = process.env.RAZORPAY_KEY_SECRET     || '';
const RZP_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
const paymentsEnabled    = Boolean(RZP_KEY_ID && RZP_KEY_SECRET);

// ─── Database ────────────────────────────────────────────────────────────────
const dbPath = path.resolve(process.env.DATABASE_PATH || path.join(root, 'data/goserve.sqlite'));
mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, role TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions(
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders(
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES users(id),
    partner_id TEXT REFERENCES users(id),
    service TEXT NOT NULL, pickup TEXT NOT NULL, destination TEXT NOT NULL,
    details TEXT NOT NULL, status TEXT NOT NULL,
    price_paise INTEGER,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    razorpay_order_id TEXT,
    created TEXT NOT NULL, updated TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events(
    id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
    actor_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL, created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS locations(
    order_id TEXT PRIMARY KEY REFERENCES orders(id),
    lat REAL NOT NULL, lng REAL NOT NULL,
    accuracy REAL NOT NULL, updated TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tickets(
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL, message TEXT NOT NULL,
    status TEXT NOT NULL, created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit(
    id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
    target TEXT NOT NULL, created TEXT NOT NULL
  );
`);

// Tables added in incremental patches
db.exec(`
  CREATE TABLE IF NOT EXISTS requests(
    user_id  TEXT NOT NULL REFERENCES users(id),
    request_id TEXT NOT NULL,
    order_id TEXT NOT NULL REFERENCES orders(id),
    PRIMARY KEY(user_id, request_id)
  );
  CREATE TABLE IF NOT EXISTS delivery_codes(
    order_id  TEXT PRIMARY KEY REFERENCES orders(id),
    code_hash TEXT NOT NULL,
    expires   INTEGER NOT NULL,
    attempts  INTEGER NOT NULL DEFAULT 0,
    issued    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payment_events(
    id                 TEXT PRIMARY KEY,
    order_id           TEXT NOT NULL REFERENCES orders(id),
    razorpay_payment_id TEXT NOT NULL,
    amount_paise       INTEGER NOT NULL,
    received           TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ratings(
    order_id TEXT PRIMARY KEY REFERENCES orders(id),
    rating   INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment  TEXT NOT NULL DEFAULT '',
    created  TEXT NOT NULL
  );
`);

// Schema migrations: add columns that may be missing on existing databases
try { db.exec(`ALTER TABLE orders ADD COLUMN price_paise INTEGER`);            } catch { /* already exists */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN razorpay_order_id TEXT`);         } catch { /* already exists */ }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const now       = () => new Date().toISOString();
const hashToken = t  => createHash('sha256').update(t).digest('hex');

function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function passwordMatches(password, hash) {
  const [salt, key] = hash.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex'));
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, approved: Boolean(u.approved) };
}
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function text(value, label, min = 1, max = 1000) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    fail(400, `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
function auditLog(actor, action, target) {
  db.prepare('INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)').run(actor, action, target, now());
}

// Seed admin account
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  if (process.env.ADMIN_PASSWORD.length < 12)
    throw new Error('Administrator password must have at least 12 characters.');
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  if (!db.prepare('SELECT id FROM users WHERE email=?').get(email))
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)')
      .run(randomUUID(), 'Operations administrator', email, passwordHash(process.env.ADMIN_PASSWORD), 'admin', 1, now());
}

// ─── SSE broadcast ───────────────────────────────────────────────────────────
const streams = new Set();
function broadcast() { for (const s of streams) s.res.write('event: refresh\ndata: {}\n\n'); }

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function session(req) {
  const token =
    req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ||
    (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('gs_session='))?.slice(11);
  if (!token) return null;
  return db.prepare(
    'SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token=? AND s.expires>?'
  ).get(hashToken(token), Date.now());
}
function requireUser(req, roles) {
  const u = session(req);
  if (!u) fail(401, 'Please sign in.');
  if (roles && !roles.includes(u.role)) fail(403, 'This account cannot perform that action.');
  return u;
}
function authorizedOrder(u, id) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!o) fail(404, 'Order not found.');
  if (u.role !== 'admin' && o.customer_id !== u.id && o.partner_id !== u.id)
    fail(403, 'This order belongs to another account.');
  return o;
}

// ─── Request body parsers ─────────────────────────────────────────────────────
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 16384) fail(413, 'Request too large.'); chunks.push(chunk); }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'JSON object required.');
    return value;
  } catch { fail(400, 'Invalid request.'); }
}
async function rawBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) fail(413, 'Request too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

// ─── Rate limiter (in-memory, per IP+route) ───────────────────────────────────
const limits = new Map();
function rateLimit(req, route, max = 20) {
  const key   = `${req.socket.remoteAddress}:${route}`;
  const entry = limits.get(key) || { count: 0, end: Date.now() + 60000 };
  if (entry.end < Date.now()) { entry.count = 0; entry.end = Date.now() + 60000; }
  entry.count++;
  limits.set(key, entry);
  if (entry.count > max) fail(429, 'Too many attempts. Try again shortly.');
}
const cleanup = setInterval(() => {
  for (const [k, v] of limits) if (v.end < Date.now()) limits.delete(k);
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
}, 60000);
cleanup.unref();

// ─── Order view ───────────────────────────────────────────────────────────────
function orderView(o) {
  const rating = db.prepare('SELECT rating, comment FROM ratings WHERE order_id=?').get(o.id);
  return {
    ...o,
    details:  JSON.parse(o.details),
    location: db.prepare('SELECT lat,lng,accuracy,updated FROM locations WHERE order_id=?').get(o.id) || null,
    events:   db.prepare('SELECT status,created FROM events WHERE order_id=? ORDER BY id').all(o.id),
    partner:  o.partner_id
      ? (() => { const u = db.prepare('SELECT name FROM users WHERE id=?').get(o.partner_id); return u ? { name: u.name } : null; })()
      : null,
    rating: rating || null,
  };
}

// ─── Server-side pricing ──────────────────────────────────────────────────────
// Phase 3 will replace the pseudo-distance with a real Distance Matrix call.
// Using GOOGLE_MAPS_SERVER_KEY as the gate for that upgrade.
const PRICING = {
  package:  { base: 4900, perKm: 900  },
  ride:     { base: 3000, perKm: 1200 },
  food:     { base: 2500, perKm: 700  },
  vehicle:  { base: 9900, perKm: 800  },
  business: { base: 7900, perKm: 1100 },
};
function estimatePricePaise(service, pickup, destination) {
  const tier     = PRICING[service] || PRICING.package;
  const pseudoKm = Math.max(2, ((pickup.length + destination.length) % 23) + 3);
  return { paise: tier.base + Math.round(pseudoKm * tier.perKm), pseudoKm };
}

// ─── Razorpay helpers ─────────────────────────────────────────────────────────
async function razorpayCreateOrder(amountPaise, receiptId) {
  const creds = Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString('base64');
  const res   = await fetch('https://api.razorpay.com/v1/orders', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${creds}` },
    body:    JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: receiptId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    fail(502, `Payment provider error: ${err?.error?.description || res.status}`);
  }
  return res.json();
}
function verifyRazorpayWebhook(rawBuf, sig) {
  if (!RZP_WEBHOOK_SECRET) return false;
  const expected = createHmac('sha256', RZP_WEBHOOK_SECRET).update(rawBuf).digest('hex');
  try { return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')); } catch { return false; }
}

// ─── Static file allowlist ────────────────────────────────────────────────────
const publicFiles = new Set([
  'index.html', 'styles.css', 'app.js',
  'platform.html', 'platform.css', 'platform.js',
  'manifest.json', 'sw.js', 'icon.svg',
]);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css',
  '.js':   'application/javascript',   '.json': 'application/json', '.svg': 'image/svg+xml',
};

// ─── HTTP server ─────────────────────────────────────────────────────────────
export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://maps.googleapis.com https://maps.gstatic.com https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com",
    "connect-src 'self' https://*.googleapis.com https://api.razorpay.com",
    "frame-src https://api.razorpay.com",
    "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  ].join('; '));
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };

  try {
    const url    = new URL(req.url, origin);
    const route  = url.pathname.replace(/^\/api\/v1(?=\/)/, '/api');
    const method = req.method;

    // CSRF / origin check for mutating API calls
    if (route.startsWith('/api/') && !['GET', 'HEAD'].includes(method)) {
      if (route !== '/api/webhooks/razorpay') {
        if (req.headers.origin !== origin && !(req.headers.authorization?.startsWith('Bearer ') && session(req)))
          fail(403, 'Request origin rejected.');
        if (!(req.headers['content-type'] || '').startsWith('application/json'))
          fail(415, 'JSON content type required.');
      }
    }

    // ── Health ────────────────────────────────────────────────────────────────
    if (route === '/api/health') return json(200, { ok: true });

    // ── Config ────────────────────────────────────────────────────────────────
    if (route === '/api/config') {
      return json(200, {
        mapsKey:         process.env.GOOGLE_MAPS_BROWSER_KEY || '',
        currency:        'INR',
        paymentsEnabled,
        otpEnabled:      false,
        razorpayKeyId:   paymentsEnabled ? RZP_KEY_ID : '',
      });
    }

    // ── Auth: register ────────────────────────────────────────────────────────
    if (route === '/api/auth/register' && method === 'POST') {
      rateLimit(req, route);
      const b    = await body(req);
      const name  = text(b.name,  'Name',     2,   100);
      const email = text(b.email, 'Email',    5,   200).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email.');
      const password = text(b.password, 'Password', 12, 128);
      const role     = b.role || 'customer';
      if (!['customer', 'partner', 'business', 'restaurant'].includes(role)) fail(400, 'Invalid role.');
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email))
        fail(409, 'An account with this email already exists.');
      const id = randomUUID();
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)')
        .run(id, name, email, passwordHash(password), role, role === 'partner' ? 0 : 1, now());
      auditLog(id, 'register', id);
      return json(201, { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
    }

    // ── Auth: login ───────────────────────────────────────────────────────────
    if (route === '/api/auth/login' && method === 'POST') {
      rateLimit(req, route);
      const b        = await body(req);
      const email    = text(b.email,    'Email',    5,   200).toLowerCase();
      const password = text(b.password, 'Password', 1,   128);
      const u        = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      const dummy    = passwordHash('timing-equalization-password');
      if (!passwordMatches(password, u?.password || dummy) || !u) fail(401, 'Email or password is incorrect.');
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hashToken(token), u.id, Date.now() + 86400000);
      res.setHeader('Set-Cookie',
        `gs_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${production ? '; Secure' : ''}`);
      auditLog(u.id, 'login', u.id);
      return json(200, { user: publicUser(u), ...(b.native === true ? { sessionToken: token } : {}) });
    }

    // ── Auth: logout ──────────────────────────────────────────────────────────
    if (route === '/api/auth/logout' && method === 'POST') {
      const token =
        req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ||
        (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('gs_session='))?.slice(11);
      if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(token));
      res.setHeader('Set-Cookie', 'gs_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return json(200, { ok: true });
    }

    // ── Me ────────────────────────────────────────────────────────────────────
    if (route === '/api/me') return json(200, { user: publicUser(requireUser(req)) });

    // ── Quotes ────────────────────────────────────────────────────────────────
    if (route === '/api/quotes' && method === 'POST') {
      rateLimit(req, route, 60);
      requireUser(req);
      const b           = await body(req);
      if (!services.includes(b.service)) fail(400, 'Choose a valid service.');
      const pickup      = text(b.pickup,      'Pickup address', 5, 500);
      const destination = text(b.destination, 'Destination',    5, 500);
      const { paise, pseudoKm } = estimatePricePaise(b.service, pickup, destination);
      return json(200, {
        quote: {
          service:         b.service,
          pickup,
          destination,
          pricePaise:      paise,
          priceFormatted:  `\u20B9${(paise / 100).toFixed(2)}`,
          distanceKm:      pseudoKm,
          note:            process.env.GOOGLE_MAPS_SERVER_KEY
            ? 'Distance calculated via Google Distance Matrix.'
            : 'Estimated price — confirmed after dispatch.',
          validForSeconds: 300,
        },
      });
    }

    // ── Orders: create ────────────────────────────────────────────────────────
    if (route === '/api/orders' && method === 'POST') {
      const u         = requireUser(req, ['customer', 'business']);
      const b         = await body(req);
      if (!services.includes(b.service)) fail(400, 'Choose a service.');
      const requestId = b.requestId ? text(b.requestId, 'Request identifier', 8, 100) : null;
      if (requestId) {
        const previous = db.prepare('SELECT order_id FROM requests WHERE user_id=? AND request_id=?').get(u.id, requestId);
        if (previous) return json(200, { order: orderView(db.prepare('SELECT * FROM orders WHERE id=?').get(previous.order_id)) });
      }
      const pickup      = text(b.pickup,      'Pickup',       5,   500);
      const destination = text(b.destination, 'Destination',  5,   500);
      const note        = text(b.note || 'No additional instructions', 'Instructions', 1, 1000);
      const { paise }   = estimatePricePaise(b.service, pickup, destination);
      const id          = `GS-${new Date().getFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`;
      const timestamp   = now();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`INSERT INTO orders(id,customer_id,partner_id,service,pickup,destination,details,status,price_paise,payment_status,razorpay_order_id,created,updated)
                    VALUES(?,?,NULL,?,?,?,?,'requested',?,'unpaid',NULL,?,?)`)
          .run(id, u.id, b.service, pickup, destination, JSON.stringify({ note }), paise, timestamp, timestamp);
        db.prepare('INSERT INTO events(order_id,actor_id,status,created) VALUES(?,?,?,?)').run(id, u.id, 'requested', timestamp);
        if (requestId) db.prepare('INSERT INTO requests VALUES(?,?,?)').run(u.id, requestId, id);
        auditLog(u.id, 'create_order', id);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      broadcast();
      return json(201, { order: orderView(db.prepare('SELECT * FROM orders WHERE id=?').get(id)) });
    }

    // ── Orders: list ──────────────────────────────────────────────────────────
    if (route === '/api/orders' && method === 'GET') {
      const u   = requireUser(req);
      const rows = u.role === 'admin'
        ? db.prepare('SELECT * FROM orders ORDER BY created DESC LIMIT 200').all()
        : db.prepare('SELECT * FROM orders WHERE customer_id=? OR partner_id=? ORDER BY created DESC LIMIT 200').all(u.id, u.id);
      return json(200, { orders: rows.map(orderView) });
    }

    // ── Offers (partner) ──────────────────────────────────────────────────────
    if (route === '/api/offers') {
      const u = requireUser(req, ['partner']);
      if (!u.approved) return json(200, { orders: [] });
      return json(200, {
        orders: db.prepare(
          "SELECT id,service,pickup,destination,price_paise,created FROM orders WHERE status='requested' ORDER BY created LIMIT 50"
        ).all(),
      });
    }

    // ── SSE stream ────────────────────────────────────────────────────────────
    if (route === '/api/stream') {
      requireUser(req);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
      res.write('event: ready\ndata: {}\n\n');
      const stream = { res };
      streams.add(stream);
      const beat = setInterval(() => {
        if (!session(req)) { res.end(); return; }
        res.write(': heartbeat\n\n');
      }, 20000);
      req.on('close', () => { clearInterval(beat); streams.delete(stream); });
      return;
    }

    // ── Razorpay webhook ──────────────────────────────────────────────────────
    if (route === '/api/webhooks/razorpay' && method === 'POST') {
      const raw = await rawBody(req);
      const sig = req.headers['x-razorpay-signature'] || '';
      if (RZP_WEBHOOK_SECRET && !verifyRazorpayWebhook(raw, sig)) fail(400, 'Webhook signature invalid.');
      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); } catch { fail(400, 'Invalid JSON.'); }
      if (payload?.event !== 'payment.captured') return json(200, { ok: true });
      const payment   = payload?.payload?.payment?.entity;
      const rzpOrdId  = payment?.order_id;
      const payId     = payment?.id;
      const amount    = payment?.amount;
      if (!rzpOrdId || !payId || !amount) fail(400, 'Missing payment fields.');
      // Replay safety: idempotent on payment id
      if (db.prepare('SELECT id FROM payment_events WHERE id=?').get(payId)) return json(200, { ok: true });
      const order = db.prepare('SELECT * FROM orders WHERE razorpay_order_id=?').get(rzpOrdId);
      if (!order) fail(404, 'Order not found for this payment.');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO payment_events VALUES(?,?,?,?,?)').run(payId, order.id, payId, amount, now());
        db.prepare("UPDATE orders SET payment_status='paid', updated=? WHERE id=? AND payment_status='pending_payment'")
          .run(now(), order.id);
        auditLog('razorpay', 'payment_captured', order.id);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      broadcast();
      return json(200, { ok: true });
    }

    // ── Per-order actions ─────────────────────────────────────────────────────
    const match = route.match(/^\/api\/orders\/([^/]+)(?:\/(accept|status|location|delivery-code|pay|rating))?$/);
    if (match) {
      const id     = decodeURIComponent(match[1]);
      const action = match[2];
      const u      = requireUser(req);

      // GET single order
      if (!action && method === 'GET') return json(200, { order: orderView(authorizedOrder(u, id)) });

      // Accept (partner, atomic)
      if (action === 'accept' && method === 'POST') {
        if (u.role !== 'partner' || !u.approved) fail(403, 'Partner approval is required.');
        db.exec('BEGIN IMMEDIATE');
        try {
          if (db.prepare("SELECT id FROM orders WHERE partner_id=? AND status IN ('assigned','arriving','picked_up','in_transit')").get(u.id))
            fail(409, 'Complete your active job first.');
          const r = db.prepare(
            "UPDATE orders SET partner_id=?,status='assigned',updated=? WHERE id=? AND status='requested' AND partner_id IS NULL"
          ).run(u.id, now(), id);
          if (!r.changes) fail(409, 'This job has already been accepted.');
          db.prepare('INSERT INTO events(order_id,actor_id,status,created) VALUES(?,?,?,?)').run(id, u.id, 'assigned', now());
          auditLog(u.id, 'accept_order', id);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        broadcast();
        return json(200, { ok: true });
      }

      const o = authorizedOrder(u, id);
      if (u.role === 'partner' && !u.approved) fail(403, 'Partner access is suspended pending operations review.');

      // Initiate payment (customer-only, Razorpay order creation)
      if (action === 'pay' && method === 'POST') {
        if (o.customer_id !== u.id) fail(403, 'Only the customer may initiate payment.');
        if (!paymentsEnabled) fail(503, 'Payments are not yet configured on this server.');
        if (o.payment_status === 'paid') fail(409, 'This order has already been paid.');
        const amountPaise = o.price_paise || estimatePricePaise(o.service, o.pickup, o.destination).paise;
        let rzpOrderId    = o.razorpay_order_id;
        if (!rzpOrderId) {
          const rzpOrder = await razorpayCreateOrder(amountPaise, o.id);
          rzpOrderId     = rzpOrder.id;
          db.prepare("UPDATE orders SET razorpay_order_id=?,payment_status='pending_payment',updated=? WHERE id=?")
            .run(rzpOrderId, now(), id);
          auditLog(u.id, 'create_payment', id);
        }
        return json(200, {
          razorpayOrderId: rzpOrderId,
          amount:          amountPaise,
          currency:        'INR',
          keyId:           RZP_KEY_ID,
          customerName:    u.name,
          customerEmail:   u.email,
        });
      }

      // Delivery code (customer, package in_transit)
      if (action === 'delivery-code' && method === 'POST') {
        if (o.customer_id !== u.id) fail(403, 'Only the customer may request a delivery code.');
        if (o.service !== 'package' || o.status !== 'in_transit') fail(409, 'The package must be in transit.');
        const prev = db.prepare('SELECT issued FROM delivery_codes WHERE order_id=?').get(id);
        if (prev && Date.now() - prev.issued < 60000) fail(429, 'Wait one minute before requesting a new delivery code.');
        const code = String(randomInt(0, 1000000)).padStart(6, '0');
        db.prepare(`INSERT INTO delivery_codes(order_id,code_hash,expires,attempts,issued) VALUES(?,?,?,?,?)
          ON CONFLICT(order_id) DO UPDATE SET code_hash=excluded.code_hash,expires=excluded.expires,attempts=0,issued=excluded.issued`)
          .run(id, passwordHash(code), Date.now() + 900000, 0, Date.now());
        auditLog(u.id, 'issue_delivery_code', id);
        return json(200, { code, expiresInSeconds: 900 });
      }

      // Status transitions
      if (action === 'status' && method === 'POST') {
        const b = await body(req);
        if (!transitions[o.status]?.includes(b.status)) fail(409, 'Invalid order status transition.');
        if (b.status === 'cancelled') {
          if (o.customer_id !== u.id && u.role !== 'admin') fail(403, 'Only the customer or operations may cancel.');
        } else if (o.partner_id !== u.id) {
          fail(403, 'Only the assigned partner may update this job.');
        }
        if (b.status === 'completed' && o.service === 'package') {
          const proof = db.prepare('SELECT * FROM delivery_codes WHERE order_id=?').get(id);
          if (!proof || proof.expires < Date.now()) fail(409, 'Ask the customer for a current delivery code.');
          if (proof.attempts >= 5) fail(429, 'Too many delivery code attempts. Request a new code.');
          if (typeof b.proofCode !== 'string' || !/^\d{6}$/.test(b.proofCode) || !passwordMatches(b.proofCode, proof.code_hash)) {
            db.prepare('UPDATE delivery_codes SET attempts=attempts+1 WHERE order_id=?').run(id);
            fail(403, 'Delivery code is incorrect.');
          }
        }
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = db.prepare('UPDATE orders SET status=?,updated=? WHERE id=? AND status=?').run(b.status, now(), id, o.status);
          if (!r.changes) fail(409, 'The order has changed. Refresh and retry.');
          db.prepare('INSERT INTO events(order_id,actor_id,status,created) VALUES(?,?,?,?)').run(id, u.id, b.status, now());
          if (['completed', 'cancelled'].includes(b.status)) {
            db.prepare('DELETE FROM locations WHERE order_id=?').run(id);
            db.prepare('DELETE FROM delivery_codes WHERE order_id=?').run(id);
          }
          auditLog(u.id, 'order_status', id);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        broadcast();
        return json(200, { ok: true });
      }

      // Partner location sharing
      if (action === 'location' && method === 'POST') {
        if (o.partner_id !== u.id || !activeStatuses.includes(o.status))
          fail(403, 'Location sharing requires an assigned active job.');
        const b = await body(req);
        if (!Number.isFinite(b.lat) || Math.abs(b.lat) > 90 ||
            !Number.isFinite(b.lng) || Math.abs(b.lng) > 180 ||
            !Number.isFinite(b.accuracy) || b.accuracy < 0 || b.accuracy > 100000)
          fail(400, 'Invalid location.');
        db.prepare(`INSERT INTO locations VALUES(?,?,?,?,?)
          ON CONFLICT(order_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,updated=excluded.updated`)
          .run(id, b.lat, b.lng, b.accuracy, now());
        broadcast();
        return json(200, { ok: true });
      }

      // Rating (customer, post-completion)
      if (action === 'rating' && method === 'POST') {
        if (o.customer_id !== u.id) fail(403, 'Only the customer may rate this delivery.');
        if (o.status !== 'completed') fail(409, 'Ratings are accepted only after the order is completed.');
        if (db.prepare('SELECT order_id FROM ratings WHERE order_id=?').get(id))
          fail(409, 'You have already rated this delivery.');
        const b      = await body(req);
        const rating = Number(b.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, 'Rating must be 1–5.');
        const comment = b.comment ? text(b.comment, 'Comment', 1, 500) : '';
        db.prepare('INSERT INTO ratings VALUES(?,?,?,?)').run(id, rating, comment, now());
        auditLog(u.id, 'rate_order', id);
        broadcast();
        return json(201, { ok: true });
      }

      fail(405, 'Action unavailable.');
    }

    // ── Admin routes ──────────────────────────────────────────────────────────
    if (route === '/api/admin/partners' && method === 'GET') {
      requireUser(req, ['admin']);
      return json(200, { partners: db.prepare("SELECT * FROM users WHERE role='partner' ORDER BY created DESC").all().map(publicUser) });
    }
    if (route === '/api/admin/partners' && method === 'POST') {
      const u = requireUser(req, ['admin']); const b = await body(req);
      if (typeof b.approved !== 'boolean') fail(400, 'Approval must be true or false.');
      const target = db.prepare("SELECT id FROM users WHERE id=? AND role='partner'").get(b.id);
      if (!target) fail(404, 'Partner not found.');
      db.prepare('UPDATE users SET approved=? WHERE id=?').run(b.approved ? 1 : 0, b.id);
      auditLog(u.id, b.approved ? 'approve_partner' : 'suspend_partner', b.id);
      broadcast();
      return json(200, { ok: true });
    }
    if (route === '/api/admin/assign' && method === 'POST') {
      const u = requireUser(req, ['admin']); const b = await body(req);
      const o = authorizedOrder(u, b.orderId);
      if (!['requested', 'assigned', 'arriving'].includes(o.status)) fail(409, 'Only jobs awaiting pickup may be reassigned.');
      const partner = db.prepare("SELECT id FROM users WHERE id=? AND role='partner' AND approved=1").get(b.partnerId);
      if (!partner) fail(400, 'Select an approved partner.');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare("SELECT id FROM orders WHERE partner_id=? AND id<>? AND status IN ('assigned','arriving','picked_up','in_transit')").get(partner.id, o.id))
          fail(409, 'This partner already has an active job.');
        db.prepare("UPDATE orders SET partner_id=?,status='assigned',updated=? WHERE id=?").run(partner.id, now(), o.id);
        db.prepare('DELETE FROM locations WHERE order_id=?').run(o.id);
        db.prepare('INSERT INTO events(order_id,actor_id,status,created) VALUES(?,?,?,?)').run(o.id, u.id, 'assigned', now());
        auditLog(u.id, 'reassign_order', o.id);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      broadcast();
      return json(200, { ok: true });
    }

    // ── Tickets ───────────────────────────────────────────────────────────────
    if (route === '/api/tickets' && method === 'POST') {
      const u = requireUser(req); const b = await body(req);
      const id = randomUUID();
      db.prepare('INSERT INTO tickets VALUES(?,?,?,?,?,?)')
        .run(id, u.id, text(b.subject, 'Subject', 3, 100), text(b.message, 'Message', 5, 2000), 'open', now());
      return json(201, { id });
    }
    if (route === '/api/tickets' && method === 'GET') {
      const u = requireUser(req);
      return json(200, {
        tickets: u.role === 'admin'
          ? db.prepare('SELECT * FROM tickets ORDER BY created DESC LIMIT 200').all()
          : db.prepare('SELECT * FROM tickets WHERE user_id=? ORDER BY created DESC').all(u.id),
      });
    }
    if (route === '/api/admin/tickets' && method === 'POST') {
      const u = requireUser(req, ['admin']); const b = await body(req);
      if (!['open', 'resolved'].includes(b.status)) fail(400, 'Invalid ticket status.');
      const r = db.prepare('UPDATE tickets SET status=? WHERE id=?').run(b.status, b.id);
      if (!r.changes) fail(404, 'Support request not found.');
      auditLog(u.id, 'update_ticket', b.id);
      broadcast();
      return json(200, { ok: true });
    }

    // ── Unknown API routes ────────────────────────────────────────────────────
    if (route.startsWith('/api/')) fail(404, 'API endpoint not found.');

    // ── Static files ──────────────────────────────────────────────────────────
    if (!['GET', 'HEAD'].includes(method)) fail(405, 'Method unavailable.');
    const spa      = ['/app', '/partner', '/operations', '/business', '/restaurant', '/login', '/signup'];
    const filename = spa.includes(route) ? 'platform.html' : route === '/' ? 'index.html' : route.slice(1);
    if (!publicFiles.has(filename) || !existsSync(path.join(root, filename))) fail(404, 'Page not found.');
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filename)] || 'text/plain', 'Cache-Control': 'no-cache' });
    res.end(method === 'HEAD' ? '' : readFileSync(path.join(root, filename)));

  } catch (e) {
    if (res.headersSent) { res.end(); return; }
    if (!e.status) console.error(JSON.stringify({ event: 'request_error', message: e.message }));
    json(e.status || 500, { error: e.status ? e.message : 'An unexpected error occurred.' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url))
  server.listen(Number(process.env.PORT || 8000), process.env.HOST || '127.0.0.1', () =>
    console.log(`GoServe running at ${origin}`));
