/**
 * GoServe platform.js — Phase 1
 * Modular, readable client application for the full courier flow.
 */

// ─── Utilities ───────────────────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const label = s => String(s).replaceAll('_', ' ');

const navigationUrl = addr =>
  `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination: addr, travelmode: 'driving', dir_action: 'navigate' })}`;

function showMessage(text, isError = true) {
  const el = document.getElementById('globalMessage');
  el.textContent = text;
  el.style.color = isError ? '' : 'var(--clr-success)';
}
function clearMessage() { showMessage('', false); }

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

// ─── API client ───────────────────────────────────────────────────────────────

async function api(route, data, method) {
  const isGet = data === undefined && !method;
  const r = await fetch(`/api${route}`, {
    method:  method || (isGet ? 'GET' : 'POST'),
    headers: isGet ? {} : { 'Content-Type': 'application/json' },
    body:    isGet ? undefined : JSON.stringify(data ?? {}),
  });
  const body = await r.json();
  if (!r.ok) throw Object.assign(new Error(body.error || 'Request failed.'), { status: r.status });
  return body;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['assigned', 'arriving', 'picked_up', 'in_transit'];
const isActive = o => ACTIVE_STATUSES.includes(o.status);

function statusBadge(status) {
  return `<span class="badge badge-${esc(status)}">${esc(label(status))}</span>`;
}

function paymentBadge(payStatus) {
  if (!payStatus || payStatus === 'unpaid') return '';
  return `<span class="badge badge-${esc(payStatus)}">${esc(label(payStatus))}</span>`;
}

// ─── Application state ────────────────────────────────────────────────────────

let currentUser      = null;
let siteConfig       = null;
let currentOrders    = [];
let sharingOrderId   = null;
let geoWatchId       = null;
let trackingOrderId  = null;
let googleMap        = null;
let googleMarker     = null;
let googleMapsReady  = false;
let sseStream        = null;
let refreshInFlight  = false;
let refreshQueued    = false;
let opsFilter        = 'all';
let bookingQuote     = null;
let bookingRequestId = null;
let bookingSignature = null;

// ─── Router ───────────────────────────────────────────────────────────────────

const WORKSPACES = {
  customer: '/app', partner: '/partner', business: '/business',
  restaurant: '/restaurant', admin: '/operations',
};

// ─── Navigation ───────────────────────────────────────────────────────────────

function renderNav() {
  const nav = document.getElementById('mainNav');
  if (currentUser) {
    nav.innerHTML = `
      <a href="/" id="navHome">Home</a>
      <a href="${WORKSPACES[currentUser.role]}" id="navWorkspace" aria-current="page">My workspace</a>
      <a href="#sectionSupport" id="navSupport">Help &amp; support</a>`;
  } else {
    const onSignup = location.pathname === '/signup';
    nav.innerHTML = `
      <a href="/" id="navHome">Home</a>
      <a href="/login"  id="navLogin"  ${!onSignup ? 'aria-current="page"' : ''}>Sign in</a>
      <a href="/signup" id="navSignup" ${onSignup  ? 'aria-current="page"' : ''}>Create account</a>`;
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

let authMode = 'login';

function setAuthMode(mode, updateUrl = true) {
  authMode = mode;
  const isReg = mode === 'register';
  document.getElementById('authFormTitle').textContent = isReg ? 'Create your account' : 'Welcome back';
  document.getElementById('btnAuthSubmit').textContent = isReg ? 'Create account'       : 'Sign in';
  document.getElementById('btnAuthToggle').textContent = isReg
    ? 'Already have an account? Sign in' : 'Create an account';
  document.getElementById('fieldName').hidden   = !isReg;
  document.getElementById('fieldRole').hidden   = !isReg;
  document.getElementById('partnerHint').hidden = !isReg;
  document.getElementById('inputName').required = isReg;
  document.getElementById('inputPassword').autocomplete = isReg ? 'new-password' : 'current-password';
  if (updateUrl) history.replaceState(null, '', isReg ? '/signup' : '/login');
  renderNav();
}

document.getElementById('btnAuthToggle').addEventListener('click', () =>
  setAuthMode(authMode === 'login' ? 'register' : 'login'));

document.getElementById('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  clearMessage();
  const btn = document.getElementById('btnAuthSubmit');
  setLoading(btn, true);
  const data = Object.fromEntries(new FormData(e.target));
  try {
    if (authMode === 'register') await api('/auth/register', data);
    await api('/auth/login', { email: data.email, password: data.password });
    await enterWorkspace();
  } catch (err) {
    showMessage(err.message);
  } finally {
    setLoading(btn, false);
  }
});

// ─── Enter workspace ──────────────────────────────────────────────────────────

async function enterWorkspace() {
  [currentUser, siteConfig] = await Promise.all([
    api('/me').then(r => r.user),
    api('/config'),
  ]);
  history.replaceState(null, '', WORKSPACES[currentUser.role]);
  renderNav();
  document.getElementById('sectionAuth').hidden      = true;
  document.getElementById('sectionWorkspace').hidden = false;
  document.getElementById('btnLogout').hidden        = false;
  document.getElementById('roleBadge').textContent   = label(currentUser.role).toUpperCase();
  document.getElementById('greetingText').textContent = `Hello, ${currentUser.name.split(' ')[0]}.`;

  document.getElementById('areaCustomer').hidden   = !['customer'].includes(currentUser.role);
  document.getElementById('areaBusiness').hidden   = currentUser.role !== 'business';
  document.getElementById('areaPartner').hidden    = currentUser.role !== 'partner';
  document.getElementById('areaAdmin').hidden      = currentUser.role !== 'admin';
  document.getElementById('areaRestaurant').hidden = currentUser.role !== 'restaurant';

  await refresh();
  connectStream();
}

// ─── Logout ───────────────────────────────────────────────────────────────────

document.getElementById('btnLogout').addEventListener('click', async () => {
  try { stopSharing(); sseStream?.close(); await api('/auth/logout', {}); } catch { /* ignore */ }
  location.href = '/login';
});

// ─── SSE ─────────────────────────────────────────────────────────────────────

function connectStream() {
  sseStream?.close();
  sseStream = new EventSource('/api/stream');
  sseStream.addEventListener('ready', () => {
    const el = document.getElementById('connectionStatus');
    el.textContent = '● Connected · live updates';
    el.classList.add('connected');
  });
  sseStream.addEventListener('refresh', () => refresh());
  sseStream.onerror = () => {
    const el = document.getElementById('connectionStatus');
    el.textContent = 'Reconnecting…';
    el.classList.remove('connected');
  };
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

async function refresh() {
  if (!currentUser) return;
  if (refreshInFlight) { refreshQueued = true; return; }
  refreshInFlight = true;
  try {
    const [ordersRes, ticketsRes] = await Promise.all([api('/orders'), api('/tickets')]);
    currentOrders = ordersRes.orders;
    renderTickets(ticketsRes.tickets);
    if (sharingOrderId && !currentOrders.some(o => o.id === sharingOrderId && isActive(o))) stopSharing();
    switch (currentUser.role) {
      case 'partner':  await renderPartnerWorkspace(); break;
      case 'admin':    await renderOpsWorkspace();     break;
      case 'business': renderOrderList('#businessOrders', currentOrders, 'business'); break;
      default:         renderOrderList('#customerOrders', currentOrders, 'customer'); break;
    }
    if (trackingOrderId) {
      const tracked = currentOrders.find(o => o.id === trackingOrderId);
      if (tracked) updateTrackingDialog(tracked);
    }
  } catch (err) {
    showMessage(err.message);
  } finally {
    refreshInFlight = false;
    if (refreshQueued) { refreshQueued = false; queueMicrotask(refresh); }
  }
}

// ─── Quote form ───────────────────────────────────────────────────────────────

document.getElementById('quoteForm').addEventListener('submit', async e => {
  e.preventDefault();
  clearMessage();
  const btn = document.getElementById('btnGetQuote');
  setLoading(btn, true);
  const data = Object.fromEntries(new FormData(e.target));
  try {
    const res = await api('/quotes', data);
    bookingQuote = { ...data, ...res.quote };
    renderQuoteResult(res.quote);
  } catch (err) {
    showMessage(err.message);
  } finally {
    setLoading(btn, false);
  }
});

function renderQuoteResult(quote) {
  document.getElementById('quoteResult').hidden = false;
  document.getElementById('quotePrice').textContent = quote.priceFormatted;
  document.getElementById('quoteNote').textContent  = quote.note;
  document.getElementById('quoteResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Booking form ─────────────────────────────────────────────────────────────

document.getElementById('bookingForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!bookingQuote) { showMessage('Please get a quote first.'); return; }
  clearMessage();
  const btn     = document.getElementById('btnBook');
  setLoading(btn, true);
  const note    = document.getElementById('bookingNote').value;
  const payload = {
    service: bookingQuote.service, pickup: bookingQuote.pickup,
    destination: bookingQuote.destination, note,
  };
  const sig = JSON.stringify(payload);
  if (bookingSignature !== sig) { bookingSignature = sig; bookingRequestId = crypto.randomUUID(); }
  try {
    const res = await api('/orders', { ...payload, requestId: bookingRequestId });
    const order = res.order;
    bookingQuote = null; bookingSignature = null; bookingRequestId = null;
    document.getElementById('quoteResult').hidden = true;
    document.getElementById('quoteForm').reset();
    document.getElementById('bookingNote').value = '';
    showMessage(`Request ${order.id} created!`, false);
    await refresh();
    if (siteConfig?.paymentsEnabled) openPayment(order);
  } catch (err) {
    showMessage(err.message);
  } finally {
    setLoading(btn, false);
  }
});

// Business booking
document.getElementById('bizQuoteForm').addEventListener('submit', async e => {
  e.preventDefault();
  clearMessage();
  const btn = e.target.querySelector('button');
  setLoading(btn, true);
  const data = Object.fromEntries(new FormData(e.target));
  try {
    const res = await api('/quotes', data);
    bookingQuote = { ...data, ...res.quote };
    document.getElementById('bizQuoteResult').hidden = false;
    document.getElementById('bizQuotePrice').textContent = res.quote.priceFormatted;
  } catch (err) {
    showMessage(err.message);
  } finally {
    setLoading(btn, false);
  }
});

document.getElementById('bizBookingForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!bookingQuote) return;
  clearMessage();
  const btn     = e.target.querySelector('button');
  setLoading(btn, true);
  const note    = document.getElementById('bizNote').value;
  const payload = { service: bookingQuote.service, pickup: bookingQuote.pickup, destination: bookingQuote.destination, note };
  const sig     = JSON.stringify(payload);
  if (bookingSignature !== sig) { bookingSignature = sig; bookingRequestId = crypto.randomUUID(); }
  try {
    const res = await api('/orders', { ...payload, requestId: bookingRequestId });
    bookingQuote = null; bookingSignature = null; bookingRequestId = null;
    document.getElementById('bizQuoteResult').hidden = true;
    document.getElementById('bizQuoteForm').reset();
    showMessage(`Shipment ${res.order.id} created.`, false);
    await refresh();
  } catch (err) {
    showMessage(err.message);
  } finally {
    setLoading(btn, false);
  }
});

// ─── Order card HTML ──────────────────────────────────────────────────────────

function orderCardHTML(o, role) {
  const nextStatus = { assigned: 'arriving', arriving: 'picked_up', picked_up: 'in_transit', in_transit: 'completed' }[o.status];
  const active     = isActive(o);
  const isSharing  = sharingOrderId === o.id;
  const isPackage  = o.service === 'package';
  const rating     = o.rating;
  const price      = o.price_paise ? `\u20B9${(o.price_paise / 100).toFixed(2)}` : null;

  let actions = `<button class="btn btn-sm" data-action="track" data-id="${esc(o.id)}" aria-label="Track order ${esc(o.id)}">Track</button>`;

  if (role === 'customer' || role === 'business') {
    if (o.status === 'requested')
      actions += `<button class="btn btn-sm btn-danger" data-action="cancel" data-id="${esc(o.id)}">Cancel</button>`;
    if (isPackage && o.status === 'in_transit')
      actions += `<button class="btn btn-sm btn-secondary" data-action="delivery-code" data-id="${esc(o.id)}">Show delivery code</button>`;
    if (o.status === 'completed' && !rating)
      actions += `<button class="btn btn-sm" data-action="rate" data-id="${esc(o.id)}">Rate \u2605</button>`;
    if (siteConfig?.paymentsEnabled && o.payment_status === 'unpaid' && o.status !== 'cancelled')
      actions += `<button class="btn btn-sm btn-primary" data-action="pay" data-id="${esc(o.id)}">Pay now</button>`;
  }

  if (role === 'partner') {
    if (nextStatus) {
      if (nextStatus === 'completed' && isPackage) {
        actions += `<button class="btn btn-sm btn-primary" data-action="proof" data-id="${esc(o.id)}">Enter code</button>`;
      } else {
        actions += `<button class="btn btn-sm btn-primary" data-action="status" data-id="${esc(o.id)}" data-status="${esc(nextStatus)}">${esc(label(nextStatus))} \u2192</button>`;
      }
    }
    if (active) {
      actions += `<a class="btn btn-sm" href="${esc(navigationUrl(['assigned','arriving'].includes(o.status) ? o.pickup : o.destination))}" target="_blank" rel="noopener">Navigate \u2197</a>`;
      actions += `<button class="btn btn-sm ${isSharing ? 'btn-danger' : 'btn-secondary'}" data-action="share" data-id="${esc(o.id)}">${isSharing ? 'Stop sharing' : 'Share location'}</button>`;
    }
  }

  if (role === 'admin') {
    if (['requested', 'assigned', 'arriving'].includes(o.status))
      actions += `<button class="btn btn-sm" data-action="assign" data-id="${esc(o.id)}">Assign partner</button>`;
  }

  const ratingHtml = rating
    ? `<div class="order-rating">${'\u2605'.repeat(rating.rating)}${'\u2606'.repeat(5 - rating.rating)} ${esc(rating.comment || '')}</div>`
    : '';

  return `
<article class="order-card${active ? ' active-job' : ''}" id="order-${esc(o.id)}">
  <div class="order-card-head">
    <div>
      <div class="order-service">${esc(label(o.service))}</div>
      <div class="order-id">${esc(o.id)} \u00B7 ${new Date(o.created).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
      ${statusBadge(o.status)}
      ${o.payment_status && o.payment_status !== 'unpaid' ? paymentBadge(o.payment_status) : ''}
    </div>
  </div>
  <div class="order-route">
    <span>\uD83D\uDCCD <strong>${esc(o.pickup)}</strong></span>
    <span>\uD83C\uDFC1 <strong>${esc(o.destination)}</strong></span>
  </div>
  ${o.details?.note && o.details.note !== 'No additional instructions' ? `<div class="order-note">${esc(o.details.note)}</div>` : ''}
  ${price ? `<div class="order-price">${esc(price)}</div>` : ''}
  ${o.partner ? `<div class="order-partner">Partner: ${esc(o.partner.name)}</div>` : ''}
  ${ratingHtml}
  <div class="order-actions">${actions}</div>
</article>`;
}

// ─── Render order list ────────────────────────────────────────────────────────

function renderOrderList(selector, orders, role) {
  const container = document.querySelector(selector);
  if (!orders.length) {
    container.innerHTML = `<div class="empty-state"><strong>Nothing here yet.</strong><p>Your next move will appear here.</p></div>`;
    return;
  }
  container.innerHTML = orders.map(o => orderCardHTML(o, role)).join('');
}

// ─── Partner workspace ────────────────────────────────────────────────────────

async function renderPartnerWorkspace() {
  currentUser = (await api('/me')).user;
  const banner = document.getElementById('partnerBanner');
  banner.textContent = currentUser.approved
    ? 'Your account is approved. Accept a request to get moving.'
    : 'Operations approval pending. Jobs appear here after review.';
  banner.className = `info-banner${currentUser.approved ? '' : ' warn'}`;
  renderOrderList('#partnerOrders', currentOrders.filter(o => isActive(o) || o.partner_id === currentUser.id), 'partner');
  const offersRes = await api('/offers');
  const container = document.getElementById('partnerOffers');
  const offers    = offersRes.orders;
  if (!offers.length) {
    container.innerHTML = `<div class="empty-state"><strong>No requests right now.</strong><p>New requests appear automatically.</p></div>`;
    return;
  }
  container.innerHTML = offers.map(o => {
    const price = o.price_paise ? `\u20B9${(o.price_paise / 100).toFixed(2)}` : '';
    return `
<article class="order-card">
  <div class="order-card-head">
    <div>
      <div class="order-service">${esc(label(o.service))}</div>
      <div class="order-id">${new Date(o.created).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
    </div>
    ${price ? `<span style="color:var(--clr-accent);font-weight:700">${esc(price)}</span>` : ''}
  </div>
  <div class="order-route">
    <span>\uD83D\uDCCD ${esc(o.pickup)}</span>
    <span>\uD83C\uDFC1 ${esc(o.destination)}</span>
  </div>
  <div class="order-actions">
    <button class="btn btn-primary btn-sm" data-action="accept" data-id="${esc(o.id)}">Accept \u2192</button>
  </div>
</article>`;
  }).join('');
}

// ─── Operations workspace ─────────────────────────────────────────────────────

async function renderOpsWorkspace() {
  const active    = currentOrders.filter(isActive);
  const completed = currentOrders.filter(o => o.status === 'completed');
  const stats     = [
    { value: currentOrders.length, label: 'Total' },
    { value: active.length,        label: 'Active' },
    { value: completed.length,     label: 'Completed' },
    { value: currentOrders.filter(o => o.status === 'requested').length, label: 'Awaiting partner' },
  ];
  document.getElementById('opsStats').innerHTML = stats.map(s =>
    `<div class="stat-card"><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`
  ).join('');

  const filtered = applyOpsFilter(currentOrders);
  renderOrderList('#adminOrders', filtered, 'admin');

  const partnersRes = await api('/admin/partners');
  const partners    = partnersRes.partners;
  const pContainer  = document.getElementById('adminPartners');
  pContainer.innerHTML = partners.length
    ? partners.map(p => `
<article class="order-card">
  <div class="order-card-head">
    <div>
      <div class="order-service">${esc(p.name)}</div>
      <div class="order-id">${esc(p.email)}</div>
    </div>
    <span class="badge ${p.approved ? 'badge-approved' : 'badge-pending'}">${p.approved ? 'Approved' : 'Pending'}</span>
  </div>
  <div class="order-actions">
    <button class="btn btn-sm ${p.approved ? 'btn-danger' : 'btn-primary'}" data-action="approve-partner" data-id="${esc(p.id)}" data-value="${!p.approved}">
      ${p.approved ? 'Suspend' : 'Approve'}
    </button>
  </div>
</article>`).join('')
    : `<div class="empty-state"><strong>No partner registrations yet.</strong></div>`;
}

function applyOpsFilter(orders) {
  switch (opsFilter) {
    case 'requested': return orders.filter(o => o.status === 'requested');
    case 'active':    return orders.filter(o => isActive(o));
    case 'completed': return orders.filter(o => o.status === 'completed');
    default:          return orders;
  }
}

// ─── Tickets ──────────────────────────────────────────────────────────────────

function renderTickets(tickets) {
  const container = document.getElementById('myTickets');
  container.innerHTML = tickets.length
    ? tickets.map(t => `
<article class="order-card">
  <div class="order-card-head">
    <div class="order-service">${esc(t.subject)}</div>
    <span class="badge badge-${esc(t.status)}">${esc(t.status)}</span>
  </div>
  <p style="font-size:var(--text-sm);color:var(--clr-muted);margin:8px 0">${esc(t.message)}</p>
  ${currentUser?.role === 'admin' && t.status === 'open'
    ? `<div class="order-actions"><button class="btn btn-sm btn-primary" data-action="resolve-ticket" data-id="${esc(t.id)}">Resolve</button></div>`
    : ''}
</article>`).join('')
    : `<div class="empty-state"><strong>No support requests yet.</strong></div>`;
}

document.getElementById('supportForm').addEventListener('submit', async e => {
  e.preventDefault();
  clearMessage();
  const btn = e.target.querySelector('button');
  setLoading(btn, true);
  try {
    await api('/tickets', {
      subject: document.getElementById('ticketSubject').value,
      message: document.getElementById('ticketMessage').value,
    });
    e.target.reset();
    showMessage('Support request sent.', false);
    await refresh();
  } catch (err) {
    showMessage(err.message);
  } finally {
    setLoading(btn, false);
  }
});

// ─── Global click dispatcher ──────────────────────────────────────────────────

document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  if (btn.dataset.filter !== undefined) {
    opsFilter = btn.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b =>
      b.classList.toggle('btn-active', b.dataset.filter === opsFilter));
    renderOrderList('#adminOrders', applyOpsFilter(currentOrders), 'admin');
    return;
  }

  const action  = btn.dataset.action;
  const orderId = btn.dataset.id;
  clearMessage();
  try {
    switch (action) {
      case 'track':           openTrackingDialog(orderId); break;
      case 'cancel':          await doStatusUpdate(orderId, 'cancelled'); break;
      case 'status':          await doStatusUpdate(orderId, btn.dataset.status); break;
      case 'accept':          await api(`/orders/${encodeURIComponent(orderId)}/accept`, {}); await refresh(); break;
      case 'delivery-code':   await openDeliveryCode(orderId); break;
      case 'proof':           openProofDialog(orderId); break;
      case 'pay':             await openPayment(currentOrders.find(o => o.id === orderId)); break;
      case 'rate':            openRatingDialog(orderId); break;
      case 'share':           toggleLocationSharing(orderId); break;
      case 'assign':          await openAssignDialog(orderId); break;
      case 'approve-partner':
        await api('/admin/partners', { id: orderId, approved: btn.dataset.value === 'true' });
        await refresh(); break;
      case 'resolve-ticket':
        await api('/admin/tickets', { id: orderId, status: 'resolved' });
        await refresh(); break;
    }
  } catch (err) {
    showMessage(err.message);
  }
});

async function doStatusUpdate(orderId, status) {
  await api(`/orders/${encodeURIComponent(orderId)}/status`, { status });
  await refresh();
}

// ─── Tracking dialog ──────────────────────────────────────────────────────────

function openTrackingDialog(orderId) {
  trackingOrderId = orderId;
  const order = currentOrders.find(o => o.id === orderId);
  if (order) updateTrackingDialog(order);
  document.getElementById('dlgTracking').showModal();
}

document.getElementById('btnCloseTracking').addEventListener('click', () => {
  document.getElementById('dlgTracking').close();
  trackingOrderId = null;
});

function updateTrackingDialog(o) {
  document.getElementById('trackingTitle').textContent = o.id;
  document.getElementById('trackingMeta').innerHTML = `
    ${statusBadge(o.status)}
    <span>${esc(o.pickup)} \u2192 ${esc(o.destination)}</span>
    ${o.partner ? `<span>Partner: ${esc(o.partner.name)}</span>` : '<span>Awaiting partner</span>'}`;
  const tl = document.getElementById('trackingTimeline');
  tl.innerHTML = (o.events || []).map(ev => `
<li>
  <span class="timeline-text">${esc(label(ev.status))}</span>
  <span class="timeline-time">${new Date(ev.created).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
</li>`).join('');
  updateMapInDialog(o);
}

function updateMapInDialog(o) {
  const mapEl  = document.getElementById('googleMap');
  const noteEl = document.getElementById('mapNote');
  const loc    = o.location;
  if (!loc) {
    mapEl.style.display = 'none';
    noteEl.textContent  = 'Partner location appears once they start sharing for this job.';
    return;
  }
  const stale = Date.now() - Date.parse(loc.updated) > 30000;
  noteEl.textContent = `Last updated: ${new Date(loc.updated).toLocaleTimeString('en-IN')} \u00B7 \u00B1${Math.round(loc.accuracy)} m${stale ? ' \u00B7 May be stale.' : ''}`;
  if (!siteConfig?.mapsKey) {
    mapEl.style.display = 'none';
    noteEl.textContent += ' (Map requires a Google Maps browser key in .env.)';
    return;
  }
  mapEl.style.display = 'block';
  loadGoogleMaps().then(() => {
    const pos = { lat: loc.lat, lng: loc.lng };
    if (!googleMap) {
      googleMap    = new google.maps.Map(mapEl, { center: pos, zoom: 15 });
      googleMarker = new google.maps.Marker({ position: pos, map: googleMap, title: 'Delivery partner' });
    } else {
      googleMarker.setPosition(pos);
      googleMap.setCenter(pos);
    }
  }).catch(() => { noteEl.textContent += ' (Map failed to load.)'; });
}

let mapsLoadPromise = null;
function loadGoogleMaps() {
  if (googleMapsReady) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;
  mapsLoadPromise = new Promise((resolve, reject) => {
    window.goServeMapsReady = () => { googleMapsReady = true; resolve(); };
    const s = document.createElement('script');
    s.src    = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(siteConfig.mapsKey)}&callback=goServeMapsReady&loading=async`;
    s.onerror = reject;
    document.head.append(s);
  });
  return mapsLoadPromise;
}

// ─── Delivery code dialog ─────────────────────────────────────────────────────

async function openDeliveryCode(orderId) {
  const res = await api(`/orders/${encodeURIComponent(orderId)}/delivery-code`, {});
  document.getElementById('deliveryCodeDisplay').textContent = res.code;
  document.getElementById('codeExpiry').textContent          = 'Valid for 15 minutes. Share only after receiving your package.';
  document.getElementById('dlgDeliveryCode').showModal();
  navigator.clipboard?.writeText(res.code).catch(() => {});
}

document.getElementById('btnCloseDeliveryCode').addEventListener('click', () =>
  document.getElementById('dlgDeliveryCode').close());

document.getElementById('btnCopyCode').addEventListener('click', () => {
  const code = document.getElementById('deliveryCodeDisplay').textContent;
  navigator.clipboard?.writeText(code).then(() => {
    document.getElementById('btnCopyCode').textContent = 'Copied \u2713';
    setTimeout(() => { document.getElementById('btnCopyCode').textContent = 'Copy code'; }, 2000);
  });
});

// ─── Rating dialog ────────────────────────────────────────────────────────────

let ratingOrderId = null;

function openRatingDialog(orderId) {
  ratingOrderId = orderId;
  document.getElementById('ratingOrderId').textContent = orderId;
  document.getElementById('ratingForm').reset();
  document.getElementById('ratingStatus').textContent = '';
  document.getElementById('dlgRating').showModal();
}

document.getElementById('btnCloseRating').addEventListener('click', () =>
  document.getElementById('dlgRating').close());

document.getElementById('ratingForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  setLoading(btn, true);
  const data = Object.fromEntries(new FormData(e.target));
  try {
    await api(`/orders/${encodeURIComponent(ratingOrderId)}/rating`, {
      rating:  Number(data.rating),
      comment: data.comment || '',
    });
    document.getElementById('dlgRating').close();
    showMessage('Thank you for your rating!', false);
    await refresh();
  } catch (err) {
    document.getElementById('ratingStatus').textContent = err.message;
  } finally {
    setLoading(btn, false);
  }
});

// ─── Payment (Razorpay Checkout) ──────────────────────────────────────────────

async function openPayment(order) {
  if (!order || !siteConfig?.paymentsEnabled) return;
  try {
    const payData = await api(`/orders/${encodeURIComponent(order.id)}/pay`, {});
    await loadRazorpay();
    const rzp = new window.Razorpay({
      key:         payData.keyId,
      amount:      payData.amount,
      currency:    payData.currency,
      order_id:    payData.razorpayOrderId,
      name:        'GoServe',
      description: `${label(order.service)} \u00B7 ${order.id}`,
      prefill:     { name: payData.customerName, email: payData.customerEmail },
      theme:       { color: '#b8f542' },
      handler:     () => {
        showMessage('Payment received! Awaiting confirmation.', false);
        setTimeout(refresh, 3000);
      },
    });
    rzp.open();
  } catch (err) {
    showMessage(err.message);
  }
}

let rzpLoadPromise = null;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (rzpLoadPromise) return rzpLoadPromise;
  rzpLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src    = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload  = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
  return rzpLoadPromise;
}

// ─── Assign partner dialog ────────────────────────────────────────────────────

let assignOrderId = null;

async function openAssignDialog(orderId) {
  assignOrderId = orderId;
  const res      = await api('/admin/partners');
  const approved = res.partners.filter(p => p.approved);
  if (!approved.length) { showMessage('Approve at least one partner first.'); return; }
  const select = document.getElementById('assignPartner');
  select.innerHTML = approved.map(p =>
    `<option value="${esc(p.id)}">${esc(p.name)} \u00B7 ${esc(p.email)}</option>`).join('');
  document.getElementById('assignStatus').textContent = '';
  document.getElementById('dlgAssign').showModal();
}

document.getElementById('btnCloseAssign').addEventListener('click', () =>
  document.getElementById('dlgAssign').close());

document.getElementById('assignForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  setLoading(btn, true);
  try {
    await api('/admin/assign', { orderId: assignOrderId, partnerId: document.getElementById('assignPartner').value });
    document.getElementById('dlgAssign').close();
    await refresh();
  } catch (err) {
    document.getElementById('assignStatus').textContent = err.message;
  } finally {
    setLoading(btn, false);
  }
});

// ─── Proof dialog (partner enters delivery code) ──────────────────────────────

let proofOrderId = null;

function openProofDialog(orderId) {
  proofOrderId = orderId;
  document.getElementById('proofForm').reset();
  document.getElementById('errorProof').textContent = '';
  document.getElementById('dlgProof').showModal();
  document.getElementById('proofCode').focus();
}

document.getElementById('btnCloseProof').addEventListener('click', () =>
  document.getElementById('dlgProof').close());

document.getElementById('proofForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  setLoading(btn, true);
  try {
    await api(`/orders/${encodeURIComponent(proofOrderId)}/status`, {
      status:    'completed',
      proofCode: document.getElementById('proofCode').value,
    });
    document.getElementById('dlgProof').close();
    showMessage('Delivery completed. Well done!', false);
    await refresh();
  } catch (err) {
    document.getElementById('errorProof').textContent = err.message;
  } finally {
    setLoading(btn, false);
  }
});

// ─── Location sharing ─────────────────────────────────────────────────────────

function toggleLocationSharing(orderId) {
  if (sharingOrderId === orderId) { stopSharing(); refresh(); return; }
  if (!navigator.geolocation) { showMessage('Geolocation is not available on this device.'); return; }
  stopSharing();
  sharingOrderId = orderId;
  let lastSent = 0;
  geoWatchId = navigator.geolocation.watchPosition(
    async ({ coords }) => {
      if (Date.now() - lastSent < 4000) return;
      lastSent = Date.now();
      try {
        await api(`/orders/${encodeURIComponent(orderId)}/location`, {
          lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy,
        });
        showMessage('Sharing your location. Keep this screen open.', false);
      } catch (err) {
        stopSharing(); showMessage(err.message); refresh();
      }
    },
    err => { stopSharing(); showMessage(`Location sharing stopped: ${err.message}`); refresh(); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
  refresh();
}

function stopSharing() {
  if (geoWatchId !== null) navigator.geolocation.clearWatch(geoWatchId);
  geoWatchId     = null;
  sharingOrderId = null;
}

window.addEventListener('beforeunload', stopSharing);

// ─── Periodic refresh ─────────────────────────────────────────────────────────

setInterval(() => {
  if (currentUser && document.visibilityState === 'visible') refresh();
}, 30000);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function boot() {
  if (location.pathname === '/signup') setAuthMode('register', false);
  else setAuthMode('login', false);

  enterWorkspace()
    .then(() => {
      const trackId = new URLSearchParams(location.search).get('tracking');
      if (trackId) {
        const order = currentOrders.find(o => o.id === trackId);
        if (order) openTrackingDialog(trackId);
        else showMessage('That tracking ID is not in your account.');
      }
      const svc = new URLSearchParams(location.search).get('service');
      if (['food','ride','package','vehicle','business'].includes(svc)) {
        const sel = document.getElementById('quoteService');
        if (sel) sel.value = svc;
      }
    })
    .catch(err => {
      if (err.message !== 'Please sign in.') showMessage(err.message);
      renderNav();
    });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

boot();
