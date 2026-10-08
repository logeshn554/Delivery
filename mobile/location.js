import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { request } from './api';

const TASK = 'goserve-active-job-location';
const KEY = 'goserve.active-job';
const isWeb = Platform.OS === 'web';
let webWatchId = null;

if (!isWeb && TaskManager?.defineTask) {
  TaskManager.defineTask(TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const orderId = await SecureStore.getItemAsync(KEY);
    if (!orderId) { await stopSharing(); return; }
    const latest = data.locations[data.locations.length - 1];
    if (Date.now() - latest.timestamp > 60000) return;
    try {
      await request(`/orders/${encodeURIComponent(orderId)}/location`, {
        lat: latest.coords.latitude, lng: latest.coords.longitude, accuracy: latest.coords.accuracy ?? 1000,
      });
    } catch (err) {
      if ([401, 403, 404].includes(err.status)) await stopSharing();
    }
  });
}

export async function startSharing(orderId) {
  if (isWeb) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new Error('Geolocation is not supported in this browser.');
    }
    await stopSharing();
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, orderId); } catch {}
    let lastSent = 0;
    webWatchId = navigator.geolocation.watchPosition(
      async ({ coords }) => {
        if (Date.now() - lastSent < 4000) return;
        lastSent = Date.now();
        try {
          await request(`/orders/${encodeURIComponent(orderId)}/location`, {
            lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy || 10,
          });
        } catch {
          await stopSharing();
        }
      },
      () => { stopSharing(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return;
  }

  if ((await Location.requestForegroundPermissionsAsync()).status !== 'granted')
    throw new Error('Location permission is required to share your position.');
  if ((await Location.requestBackgroundPermissionsAsync()).status !== 'granted')
    throw new Error('Enable background location in device settings to share while navigating.');
  await stopSharing();
  await SecureStore.setItemAsync(KEY, orderId, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  try {
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10,
      showsBackgroundLocationIndicator: true, pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'GoServe job tracking is on',
        notificationBody: 'Your location is shared with the customer for your active job.',
        killServiceOnDestroy: true,
      },
    });
  } catch (error) {
    await SecureStore.deleteItemAsync(KEY);
    throw error;
  }
}

export async function stopSharing() {
  if (isWeb) {
    if (webWatchId !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(webWatchId);
      webWatchId = null;
    }
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY); } catch {}
    return;
  }
  try { await SecureStore.deleteItemAsync(KEY); } catch {}
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) {
      await Location.stopLocationUpdatesAsync(TASK);
    }
  } catch {}
}

export async function sharingOrder() {
  if (isWeb) {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null; } catch { return null; }
  }
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}
