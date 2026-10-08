/**
 * GoServe Super App — Client Application
 * Dynamic interactions for Food, Rides, Tracking, Cart, and Wallet
 */

// ── Application State ────────────────────────────────────────────────────────
const state = {
  user: { name: 'Logesh', email: 'logesh@goserve.in', role: 'customer' },
  wallet: { balancePaise: 125000, balanceFormatted: '₹1,250.00' },
  cart: [
    { id: 'dish-mcd-1', name: 'McSpicy Chicken Burger', price: 190, qty: 2, restaurant: "McDonald's" },
    { id: 'dish-mcd-3', name: 'Peri Peri Fries (Large)', price: 120, qty: 1, restaurant: "McDonald's" },
    { id: 'dish-bb-1', name: 'Dum Gosht Biryani', price: 140, qty: 1, restaurant: 'Behrouz Biryani' },
  ],
  restaurants: [],
  dishes: [],
  rideOptions: [],
  recentOrders: [],
  activeOrder: {
    id: 'OD123456',
    restaurantName: "McDonald's",
    itemsSummary: '2 Chicken Burgers, 1 Fries, 1 Coke',
    price: '₹420',
    status: 'in_transit',
    partnerName: 'Ravi Kumar',
    partnerPhone: '+91 98765 43210',
    vehicle: 'TVS Apache • TN 09 AB 1234',
    rating: 4.8,
    trips: '2.1K trips',
    etaMinutes: 8,
  },
  selectedRide: 'auto',
  activeScreen: 'screen-home',
  chatMessages: [
    { sender: 'partner', message: "Hi Logesh! I've picked up your order from McDonald's and I am heading your way.", time: '1:21 PM' },
    { sender: 'customer', message: "Thanks Ravi! Please ring the doorbell upon arrival.", time: '1:24 PM' },
  ],
  callSeconds: 0,
  callTimerInterval: null,
};

// ── DOM Helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function showToast(message, icon = '✨') {
  const toast = $('globalToast');
  if (!toast) return;
  $('toastIcon').textContent = icon;
  $('toastMessage').textContent = message;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 3500);
}

// ── Clock Display ────────────────────────────────────────────────────────────
function updateClock() {
  const d = new Date();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  $$('.status-time').forEach(el => { el.textContent = `${h}:${m}`; });
}
setInterval(updateClock, 1000);
updateClock();

// ── View Mode Switcher ───────────────────────────────────────────────────────
$('btnModeShowcase')?.addEventListener('click', () => {
  $('btnModeShowcase').classList.add('active');
  $('btnModeSingle').classList.remove('active');
  $('showcaseStage').hidden = false;
  $('singleStage').hidden = true;
});

$('btnModeSingle')?.addEventListener('click', () => {
  $('btnModeSingle').classList.add('active');
  $('btnModeShowcase').classList.remove('active');
  $('showcaseStage').hidden = true;
  $('singleStage').hidden = false;
  renderSingleScreen(state.activeScreen);
});

// ── Navigation between Screens ───────────────────────────────────────────────
window.switchToScreen = function(screenId) {
  state.activeScreen = screenId;
  // If in single mode, re-render
  if (!$('singleStage').hidden) {
    renderSingleScreen(screenId);
  } else {
    // If in showcase mode, scroll to the corresponding column
    const colIndex = { 'screen-home': 0, 'screen-food': 1, 'screen-track': 2, 'screen-rides': 3 }[screenId];
    if (colIndex !== undefined) {
      const cols = $$('.showcase-column');
      if (cols[colIndex]) {
        cols[colIndex].scrollIntoView({ behavior: 'smooth', inline: 'center' });
      }
    }
  }
};

function renderSingleScreen(screenId) {
  const viewport = $('singleAppViewport');
  if (!viewport) return;
  
  // Clone corresponding phone from showcase stage
  const colIndex = { 'screen-home': 0, 'screen-food': 1, 'screen-track': 2, 'screen-rides': 3 }[screenId] || 0;
  const targetCol = $$('.showcase-column')[colIndex];
  if (targetCol) {
    const mainContent = targetCol.querySelector('main.app-viewport');
    if (mainContent) {
      viewport.innerHTML = mainContent.innerHTML;
      bindViewportEvents(viewport);
    }
  }

  // Update sidebar buttons
  $$('.screen-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === screenId);
  });
}

// ── Initialize Data from Backend ─────────────────────────────────────────────
async function initApp() {
  try {
    const res = await fetch('/api/superapp/init');
    if (res.ok) {
      const data = await res.json();
      state.user = data.user || state.user;
      state.wallet = data.wallet || state.wallet;
      state.restaurants = data.restaurants || [];
      state.dishes = data.dishes || [];
      state.rideOptions = data.rideOptions || [];
      state.recentOrders = data.recentOrders || [];

      renderRestaurants(state.restaurants);
      renderDishes(state.dishes);
      renderRecentOrders(state.recentOrders);
      updateWalletUI();
      updateCartUI();
    }
  } catch (err) {
    console.warn('Backend init fallback:', err);
  }
}

// ── Render Top Restaurants ───────────────────────────────────────────────────
function renderRestaurants(list) {
  $$('.restaurants-grid').forEach(container => {
    container.innerHTML = list.map(r => `
      <article class="restaurant-card" data-rest-id="${r.id}" onclick="openRestaurantMenu('${r.id}')">
        <div class="rest-img-wrap">
          <img src="${r.image}" alt="${r.name}" loading="lazy">
          ${r.discount ? `<span class="rest-discount-badge">${r.discount}</span>` : ''}
          <button class="rest-fav-icon" onclick="event.stopPropagation(); this.textContent = this.textContent === '❤️' ? '🤍' : '❤️'">🤍</button>
        </div>
        <div class="rest-body">
          <h4>${r.name}</h4>
          <div class="rest-rating-row">
            <span class="rating-star">★</span>
            <span class="rest-rating-val">${r.rating}</span>
            <span class="rest-rating-count">(${r.ratingCount})</span>
          </div>
          <div class="rest-eta-row">⏱️ ${r.deliveryTime}</div>
          <div class="rest-cuisines">${r.cuisines}</div>
        </div>
      </article>
    `).join('');
  });
}

// ── Render Popular Dishes ─────────────────────────────────────────────────────
function renderDishes(list) {
  $$('.popular-dishes-row').forEach(container => {
    container.innerHTML = list.map(d => `
      <div class="dish-circle-card" onclick="addToCart('${d.id}', '${d.name}', ${d.price}, '${d.restaurant || "GoServe Kitchen"}')">
        <div class="dish-thumbnail-wrap">
          <img src="${d.image}" alt="${d.name}" loading="lazy">
        </div>
        <strong>${d.name}</strong>
        <span class="dish-price">₹${d.price}</span>
        <button class="btn-add-mini">+ Add</button>
      </div>
    `).join('');
  });
}

// ── Render Recent Orders ─────────────────────────────────────────────────────
function renderRecentOrders(orders) {
  $$('.recent-orders-list').forEach(container => {
    if (!orders.length) return;
    container.innerHTML = orders.slice(0, 2).map(o => {
      const details = typeof o.details === 'string' ? JSON.parse(o.details || '{}') : (o.details || {});
      const title = details.restaurantName || o.pickup.split(',')[0] || 'Order';
      const isMcd = title.toLowerCase().includes('mcdonald');
      const priceFormatted = o.price_paise ? `₹${(o.price_paise / 100).toFixed(0)}` : '₹420';

      return `
        <article class="recent-order-item" onclick="switchToScreen('screen-track')">
          <div class="order-store-icon ${isMcd ? 'bg-red' : 'bg-green'}">
            ${isMcd ? '<span class="mcd-m">M</span>' : '<span>🛍️</span>'}
          </div>
          <div class="order-info">
            <h4>${title}</h4>
            <p class="order-date">${new Date(o.created).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
            <span class="badge-status-delivered">● ${o.status === 'in_transit' ? 'On the Way' : 'Delivered'}</span>
          </div>
          <div class="order-price-col">
            <span class="order-cost">${priceFormatted}</span>
            <button class="btn-reorder">${o.status === 'in_transit' ? 'Track ↗' : 'Details'}</button>
          </div>
        </article>
      `;
    }).join('');
  });
}

// ── Cart Management ──────────────────────────────────────────────────────────
window.addToCart = function(id, name, price, restaurant = "McDonald's") {
  const existing = state.cart.find(item => item.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({ id, name, price, qty: 1, restaurant });
  }

  showToast(`Added ${name} to cart!`, '🛒');
  updateCartUI();
};

window.changeCartQty = function(id, delta) {
  const item = state.cart.find(i => i.id === id);
  if (!item) return;

  item.qty += delta;
  if (item.qty <= 0) {
    state.cart = state.cart.filter(i => i.id !== id);
  }
  updateCartUI();
};

function updateCartUI() {
  const totalCount = state.cart.reduce((sum, i) => sum + i.qty, 0);
  const itemTotal = state.cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
  const deliveryFee = itemTotal > 500 || itemTotal === 0 ? 0 : 40;
  const platformFee = itemTotal > 0 ? 5 : 0;
  const gst = Math.round(itemTotal * 0.05);
  const grandTotal = itemTotal + deliveryFee + platformFee + gst;

  // Floating Cart Bar in Food Screen
  $$('.floating-cart-bar').forEach(bar => {
    bar.hidden = totalCount === 0;
    const badge = bar.querySelector('.cart-badge-count');
    if (badge) badge.textContent = totalCount;
    const totalEl = bar.querySelector('.cart-floating-total');
    if (totalEl) totalEl.textContent = `₹${itemTotal}`;
  });

  // Cart Drawer Summary
  if ($('billItemTotal')) $('billItemTotal').textContent = `₹${itemTotal}.00`;
  if ($('billGst')) $('billGst').textContent = `₹${gst}.00`;
  if ($('billGrandTotal')) $('billGrandTotal').textContent = `₹${grandTotal}.00`;
  if ($('checkoutBtnTotal')) $('checkoutBtnTotal').textContent = `₹${grandTotal}.00`;

  // Render items in Cart Drawer
  const list = $('cartItemsList');
  if (list) {
    if (state.cart.length === 0) {
      list.innerHTML = `<p style="text-align:center;color:#64748B;padding:24px;">Your cart is empty.</p>`;
    } else {
      list.innerHTML = state.cart.map(item => `
        <div class="cart-item-row">
          <div class="cart-item-info">
            <strong>${item.name}</strong>
            <small>₹${item.price} each</small>
          </div>
          <div class="cart-item-qty">
            <button class="cart-qty-btn" onclick="changeCartQty('${item.id}', -1)">−</button>
            <span style="font-weight:700;font-size:13px;width:16px;text-align:center;">${item.qty}</span>
            <button class="cart-qty-btn" onclick="changeCartQty('${item.id}', 1)">+</button>
          </div>
        </div>
      `).join('');
    }
  }
}

// ── Cart Drawer Open/Close ───────────────────────────────────────────────────
window.openCartDrawer = function() {
  $('cartDrawerBackdrop').hidden = false;
};

$('btnCloseCart')?.addEventListener('click', () => {
  $('cartDrawerBackdrop').hidden = true;
});

$('cartDrawerBackdrop')?.addEventListener('click', e => {
  if (e.target === $('cartDrawerBackdrop')) $('cartDrawerBackdrop').hidden = true;
});

// ── Place Order Action ───────────────────────────────────────────────────────
$('btnPlaceOrderAction')?.addEventListener('click', async () => {
  if (!state.cart.length) {
    showToast('Your cart is empty!', '⚠️');
    return;
  }

  const btn = $('btnPlaceOrderAction');
  btn.disabled = true;
  btn.textContent = 'Placing Order…';

  try {
    const itemTotal = state.cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const res = await fetch('/api/food/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurantName: state.cart[0]?.restaurant || "McDonald's",
        items: state.cart,
        totalPaise: (itemTotal + 37) * 100,
        destination: 'Flat 302, 4th Avenue, Anna Nagar, Chennai',
      }),
    });

    const data = await res.json();
    $('cartDrawerBackdrop').hidden = true;
    state.cart = [];
    updateCartUI();

    // Deduct from wallet balance
    state.wallet.balancePaise = Math.max(0, state.wallet.balancePaise - 67700);
    state.wallet.balanceFormatted = `₹${(state.wallet.balancePaise / 100).toFixed(2)}`;
    updateWalletUI();

    showToast('Order confirmed! Ravi is on the way.', '🎉');
    switchToScreen('screen-track');
    startTrackingAnimation();
  } catch (err) {
    showToast(err.message || 'Could not place order', '❌');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Place Order ↗';
  }
});

// ── Live Order Tracking Animation ────────────────────────────────────────────
let trackingAnimId = null;
function startTrackingAnimation() {
  const markers = $$('.driver-map-marker');
  if (!markers.length) return;

  let progress = 0;
  clearInterval(trackingAnimId);

  trackingAnimId = setInterval(() => {
    progress = (progress + 1) % 100;
    const x = 200 + Math.sin(progress / 10) * 35;
    const y = 98 + (progress % 20);
    markers.forEach(marker => {
      marker.style.left = `${x}px`;
      marker.style.top = `${y}px`;
    });
  }, 300);
}
startTrackingAnimation();

// ── Live Chat with Driver ────────────────────────────────────────────────────
window.openChatDrawer = function() {
  $('chatDrawerBackdrop').hidden = false;
};

$('btnCloseChat')?.addEventListener('click', () => {
  $('chatDrawerBackdrop').hidden = true;
});

$('chatDrawerBackdrop')?.addEventListener('click', e => {
  if (e.target === $('chatDrawerBackdrop')) $('chatDrawerBackdrop').hidden = true;
});

$('chatInputForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('chatTextInput');
  const text = input.value.trim();
  if (!text) return;

  const container = $('chatMessagesContainer');
  const nowTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  container.innerHTML += `
    <div class="chat-bubble customer">
      <p>${text}</p>
      <span class="chat-time">${nowTime}</span>
    </div>
  `;
  input.value = '';
  container.scrollTop = container.scrollHeight;

  setTimeout(async () => {
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: state.activeOrder.id, message: text }),
      });
      const data = await res.json();
      const lastMsg = data.messages?.[data.messages.length - 1];
      const reply = lastMsg?.sender === 'partner' ? lastMsg.message : "Got it! Reaching your location shortly.";

      container.innerHTML += `
        <div class="chat-bubble driver">
          <p>${reply}</p>
          <span class="chat-time">${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      `;
      container.scrollTop = container.scrollHeight;
    } catch {
      container.innerHTML += `
        <div class="chat-bubble driver">
          <p>Got it, I am almost there!</p>
          <span class="chat-time">${nowTime}</span>
        </div>
      `;
      container.scrollTop = container.scrollHeight;
    }
  }, 1000);
});

// Quick reply chips
$$('.chip-reply').forEach(chip => {
  chip.addEventListener('click', () => {
    $('chatTextInput').value = chip.dataset.reply;
    $('chatInputForm').dispatchEvent(new Event('submit'));
  });
});

// ── Phone Call Dialer Simulation ─────────────────────────────────────────────
window.openCallModal = function() {
  $('callModalBackdrop').hidden = false;
  state.callSeconds = 0;
  $('callTimerLabel').textContent = 'Connecting…';

  clearInterval(state.callTimerInterval);
  setTimeout(() => {
    $('callTimerLabel').textContent = '00:01';
    state.callTimerInterval = setInterval(() => {
      state.callSeconds += 1;
      const mins = String(Math.floor(state.callSeconds / 60)).padStart(2, '0');
      const secs = String(state.callSeconds % 60).padStart(2, '0');
      $('callTimerLabel').textContent = `${mins}:${secs}`;
    }, 1000);
  }, 1200);
};

$('btnEndCall')?.addEventListener('click', () => {
  clearInterval(state.callTimerInterval);
  $('callModalBackdrop').hidden = true;
  showToast('Call ended', '📞');
});

// ── Share Tracking Link ──────────────────────────────────────────────────────
window.shareTrackingLink = function() {
  const url = `${window.location.origin}/#track`;
  navigator.clipboard?.writeText(url).catch(() => {});
  showToast('Tracking link copied to clipboard!', '🔗');
};

// ── Ride Booking ─────────────────────────────────────────────────────────────
window.swapLocations = function() {
  const pickup = $$('.ride-pickup-input');
  const dest = $$('.ride-dest-input');
  pickup.forEach((p, idx) => {
    const d = dest[idx];
    if (p && d) {
      const temp = p.value;
      p.value = d.value;
      d.value = temp;
    }
  });
  showToast('Route swapped', '⇅');
};

window.handleBookRide = async function() {
  showToast('Matching nearby driver…', '⏳');
  try {
    const res = await fetch('/api/rides/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup: 'Anna Nagar, Chennai',
        destination: 'Chennai International Airport (MAA)',
        rideType: state.selectedRide,
      }),
    });
    const data = await res.json();
    showToast('Auto Booked! Driver arriving in 2 mins.', '🛺');
    switchToScreen('screen-track');
    startTrackingAnimation();
  } catch {
    showToast('Ride booked successfully!', '🛺');
    switchToScreen('screen-track');
  }
};

// Ride card selection delegation
document.addEventListener('click', e => {
  const card = e.target.closest('.ride-option-card');
  if (card) {
    const parentList = card.closest('.ride-options-list');
    if (parentList) {
      parentList.querySelectorAll('.ride-option-card').forEach(c => {
        c.classList.remove('active');
        const check = c.querySelector('.radio-check');
        if (check) check.textContent = '○';
      });
      card.classList.add('active');
      const input = card.querySelector('input[type="radio"]');
      if (input) input.checked = true;
      const check = card.querySelector('.radio-check');
      if (check) check.textContent = '✓';
      state.selectedRide = card.dataset.ride;
    }
  }

  // Sidebar navigation click
  const screenBtn = e.target.closest('.screen-nav-btn');
  if (screenBtn) {
    switchToScreen(screenBtn.dataset.screen);
  }
});

// Cuisine filter delegation
document.addEventListener('click', e => {
  const chip = e.target.closest('.cuisine-filter-chips .chip-btn');
  if (chip) {
    const row = chip.closest('.cuisine-filter-chips');
    row.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
    chip.classList.add('active');

    const cuisine = chip.dataset.cuisine.toLowerCase();
    if (cuisine === 'all') {
      renderRestaurants(state.restaurants);
    } else {
      const filtered = state.restaurants.filter(r => r.cuisines.toLowerCase().includes(cuisine));
      renderRestaurants(filtered.length ? filtered : state.restaurants);
    }
  }
});

// Search input delegation
document.addEventListener('input', e => {
  if (e.target.classList.contains('food-search-input')) {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderRestaurants(state.restaurants);
    } else {
      const filtered = state.restaurants.filter(r =>
        r.name.toLowerCase().includes(q) || r.cuisines.toLowerCase().includes(q)
      );
      renderRestaurants(filtered);
    }
  }
  if (e.target.classList.contains('home-search-input')) {
    const q = e.target.value.toLowerCase().trim();
    if (q.length > 2) {
      switchToScreen('screen-food');
      $$('.food-search-input').forEach(input => {
        input.value = q;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
  }
});

// ── Wallet Management ────────────────────────────────────────────────────────
function updateWalletUI() {
  const el = $('walletBalanceText');
  if (el) el.textContent = state.wallet.balanceFormatted;
}

// ── Start Application ────────────────────────────────────────────────────────
initApp();
