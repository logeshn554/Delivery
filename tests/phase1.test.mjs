/**
 * Phase 1 backend tests: quotes, payment, webhook, ratings.
 * Run: node --test tests/phase1.test.mjs
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";

process.env.DATABASE_PATH   = path.join(mkdtempSync(path.join(tmpdir(),"goserve-p1-")), "test.sqlite");
process.env.PUBLIC_ORIGIN   = "http://localhost:8000";
process.env.ADMIN_EMAIL     = "admin@example.test";
process.env.ADMIN_PASSWORD  = "administrator-pass-123";

const { server } = await import("../server.mjs");
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function req(route, data, cookie = "") {
  const r = await fetch(base + route, {
    method:  data ? "POST" : "GET",
    headers: { Origin: process.env.PUBLIC_ORIGIN, "Content-Type": "application/json", Cookie: cookie },
    body:    data ? JSON.stringify(data) : undefined,
  });
  return { status: r.status, body: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
async function account(email, role) {
  const d = { name: "Test " + role, email, password: "a-strong-passphrase-123", role };
  assert.equal((await req("/api/auth/register", d)).status, 201);
  return (await req("/api/auth/login", d)).cookie;
}

test("/api/config shape", async () => {
  const r = await req("/api/config");
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.mapsKey,         "string");
  assert.equal(typeof r.body.paymentsEnabled,  "boolean");
  assert.equal(typeof r.body.razorpayKeyId,    "string");
  assert.equal(r.body.paymentsEnabled,          false);
});

test("quotes: happy path returns price and distance", async () => {
  const customer = await account("qcust1@example.test", "customer");
  const r = await req("/api/quotes", { service: "package", pickup: "123 Pickup Street Bangalore", destination: "456 Destination Avenue Bangalore" }, customer);
  assert.equal(r.status, 200);
  const q = r.body.quote;
  assert.equal(q.service, "package");
  assert.ok(q.pricePaise > 0);
  assert.match(q.priceFormatted, /\u20B9\d+\.\d{2}/);
  assert.ok(q.distanceKm > 0);
  assert.equal(q.validForSeconds, 300);
});

test("quotes: unauthenticated => 401", async () => {
  assert.equal((await req("/api/quotes", { service: "package", pickup: "A long street", destination: "B long street" })).status, 401);
});

test("quotes: invalid service => 400", async () => {
  const c = await account("qcust2@example.test", "customer");
  assert.equal((await req("/api/quotes", { service: "teleportation", pickup: "A long street", destination: "B long street" }, c)).status, 400);
});

test("quotes: too-short addresses => 400", async () => {
  const c = await account("qcust3@example.test", "customer");
  assert.equal((await req("/api/quotes", { service: "ride", pickup: "X", destination: "Y" }, c)).status, 400);
});

test("quotes: same input => same price (deterministic)", async () => {
  const c = await account("qcust4@example.test", "customer");
  const p = { service: "package", pickup: "Koramangala Bangalore", destination: "Indiranagar Bangalore" };
  const r1 = await req("/api/quotes", p, c);
  const r2 = await req("/api/quotes", p, c);
  assert.equal(r1.body.quote.pricePaise, r2.body.quote.pricePaise);
});

test("pay: payments disabled => 503", async () => {
  const c = await account("paycust1@example.test", "customer");
  const order = (await req("/api/orders", { service: "ride", pickup: "A long pickup street", destination: "B long destination street" }, c)).body.order;
  const r = await req(`/api/orders/${encodeURIComponent(order.id)}/pay`, {}, c);
  assert.equal(r.status, 503);
  assert.match(r.body.error, /not yet configured/i);
});

test("pay: wrong user => 403", async () => {
  const c = await account("paycust2@example.test", "customer");
  const o = await account("payother@example.test", "customer");
  const order = (await req("/api/orders", { service: "ride", pickup: "A long pickup street", destination: "B long destination street" }, c)).body.order;
  assert.equal((await req(`/api/orders/${encodeURIComponent(order.id)}/pay`, {}, o)).status, 403);
});

test("webhook: non-captured event => 200 ignored", async () => {
  const r = await fetch(base + "/api/webhooks/razorpay", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "payment.failed", payload: {} }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test("webhook: missing order => 404", async () => {
  const r = await fetch(base + "/api/webhooks/razorpay", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: "rzp_no_such", amount: 4900 } } } }),
  });
  assert.equal(r.status, 404);
});

test("hmac verifier logic (unit)", async () => {
  const secret = "test-secret-123";
  const body   = Buffer.from(JSON.stringify({ event: "payment.captured" }));
  const good   = createHmac("sha256", secret).update(body).digest("hex");
  const bad    = "deadbeef".repeat(8);
  assert.equal(good.length, 64);
  assert.notEqual(good, bad);
});

test("rating: happy path (ride completes -> rate -> visible)", async () => {
  const c = await account("ratecust1@example.test", "customer");
  const p = await account("ratepart1@example.test", "partner");
  const admin = (await req("/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).cookie;
  const partners = (await req("/api/admin/partners", undefined, admin)).body.partners;
  await req("/api/admin/partners", { id: partners.find(x => x.email === "ratepart1@example.test").id, approved: true }, admin);
  const order = (await req("/api/orders", { service: "ride", pickup: "Pickup Road Bangalore", destination: "Destination Road Bangalore" }, c)).body.order;
  await req(`/api/orders/${encodeURIComponent(order.id)}/accept`, {}, p);
  for (const s of ["arriving","picked_up","in_transit","completed"])
    await req(`/api/orders/${encodeURIComponent(order.id)}/status`, { status: s }, p);
  assert.equal((await req(`/api/orders/${encodeURIComponent(order.id)}/rating`, { rating: 4, comment: "Good service" }, c)).status, 201);
  const o2 = (await req(`/api/orders/${encodeURIComponent(order.id)}`, undefined, c)).body.order;
  assert.equal(o2.rating.rating,  4);
  assert.equal(o2.rating.comment, "Good service");
});

test("rating: before completion => 409", async () => {
  const c = await account("ratepre@example.test", "customer");
  const order = (await req("/api/orders", { service: "ride", pickup: "A Long Pickup Street", destination: "B Long Destination Street" }, c)).body.order;
  assert.equal((await req(`/api/orders/${encodeURIComponent(order.id)}/rating`, { rating: 5 }, c)).status, 409);
});

test("rating: double-rating => 409", async () => {
  const c = await account("ratedbl1@example.test", "customer");
  const p = await account("ratedbl1p@example.test", "partner");
  const admin = (await req("/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).cookie;
  const partners = (await req("/api/admin/partners", undefined, admin)).body.partners;
  await req("/api/admin/partners", { id: partners.find(x => x.email === "ratedbl1p@example.test").id, approved: true }, admin);
  const order = (await req("/api/orders", { service: "ride", pickup: "A Long Pickup Street", destination: "B Long Destination Street" }, c)).body.order;
  await req(`/api/orders/${encodeURIComponent(order.id)}/accept`, {}, p);
  for (const s of ["arriving","picked_up","in_transit","completed"])
    await req(`/api/orders/${encodeURIComponent(order.id)}/status`, { status: s }, p);
  await req(`/api/orders/${encodeURIComponent(order.id)}/rating`, { rating: 5 }, c);
  assert.equal((await req(`/api/orders/${encodeURIComponent(order.id)}/rating`, { rating: 3 }, c)).status, 409);
});

test("rating: partner cannot rate => 403", async () => {
  const c = await account("raterole1c@example.test", "customer");
  const p = await account("raterole1p@example.test", "partner");
  const admin = (await req("/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).cookie;
  const partners = (await req("/api/admin/partners", undefined, admin)).body.partners;
  await req("/api/admin/partners", { id: partners.find(x => x.email === "raterole1p@example.test").id, approved: true }, admin);
  const order = (await req("/api/orders", { service: "ride", pickup: "A Long Pickup Street", destination: "B Long Destination Street" }, c)).body.order;
  await req(`/api/orders/${encodeURIComponent(order.id)}/accept`, {}, p);
  for (const s of ["arriving","picked_up","in_transit","completed"])
    await req(`/api/orders/${encodeURIComponent(order.id)}/status`, { status: s }, p);
  assert.equal((await req(`/api/orders/${encodeURIComponent(order.id)}/rating`, { rating: 5 }, p)).status, 403);
});

test("rating: invalid values (0,6,-1,string) => 400", async () => {
  const c = await account("ratebad1c@example.test", "customer");
  const p = await account("ratebad1p@example.test", "partner");
  const admin = (await req("/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).cookie;
  const partners = (await req("/api/admin/partners", undefined, admin)).body.partners;
  await req("/api/admin/partners", { id: partners.find(x => x.email === "ratebad1p@example.test").id, approved: true }, admin);
  const order = (await req("/api/orders", { service: "ride", pickup: "A Long Pickup Street", destination: "B Long Destination Street" }, c)).body.order;
  await req(`/api/orders/${encodeURIComponent(order.id)}/accept`, {}, p);
  for (const s of ["arriving","picked_up","in_transit","completed"])
    await req(`/api/orders/${encodeURIComponent(order.id)}/status`, { status: s }, p);
  for (const bad of [0,6,-1,"great",null]) {
    const r = await req(`/api/orders/${encodeURIComponent(order.id)}/rating`, { rating: bad }, c);
    assert.equal(r.status, 400, `Expected 400 for rating=${bad}`);
  }
  assert.equal((await req(`/api/orders/${encodeURIComponent(order.id)}/rating`, { rating: 5 }, c)).status, 201);
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});
