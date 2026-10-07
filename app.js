const dialog = document.querySelector('#serviceDialog');
const dialogTitle = document.querySelector('#dialogTitle');
const dialogText = document.querySelector('#dialogText');
const dialogConfirm = document.querySelector('#dialogConfirm');

document.querySelector('#year').textContent = new Date().getFullYear();

function showInterest(service = 'GoServe') {
  const types = { Food: 'food', Ride: 'ride', Package: 'package', More: 'vehicle' };
  location.href = `/login${types[service] ? '?service=' + types[service] : ''}`;
  return;
  dialogTitle.textContent = service === 'GoServe' ? 'A little something is on its way.' : `${service}, coming to your city.`;
  dialogText.textContent = service === 'GoServe'
    ? 'We’re getting the GoServe experience ready. Leave us your interest and we’ll share an update when bookings open.'
    : `We’re getting ${service.toLowerCase()} ready for our first service area. Leave us your interest and we’ll share an update when bookings open.`;
  dialogConfirm.textContent = '';
  dialog.showModal();
}

document.querySelectorAll('[data-service]').forEach((card) => {
  card.addEventListener('click', () => showInterest(card.dataset.service));
});
document.querySelector('#loginButton').addEventListener('click', () => showInterest());
document.querySelector('#dialogClose').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});
document.querySelector('#interestForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = new FormData(event.currentTarget).get('email');
  dialogConfirm.textContent = 'Thanks — this preview doesn’t store or send your address yet.';
  event.currentTarget.reset();
});
document.querySelector('#interestEmail').name = 'email';

document.querySelector('#exploreButton').addEventListener('click', () => {
  document.querySelector('#how').scrollIntoView({ behavior: 'smooth' });
});

document.querySelector('#locationButton').addEventListener('click', () => {
  const label = document.querySelector('#locationLabel');
  if (!navigator.geolocation) {
    label.textContent = 'Location unavailable';
    return;
  }
  label.textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      label.textContent = `${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`;
      document.querySelector('#locationButton').title = 'Location is used only in this page preview.';
    },
    () => { label.textContent = 'Set your location'; },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
  );
});

document.querySelector('#trackingForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = document.querySelector('#trackingId').value.trim();
  const result = document.querySelector('#trackingResult');
  result.textContent = id
    ? `Tracking preview for ${id}: order records aren’t connected yet.`
    : 'Enter a tracking number to try the preview.';
  if (id) location.href = '/app?tracking=' + encodeURIComponent(id);
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

