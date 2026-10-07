import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { request } from './api';
const TASK = 'goserve-active-job-location';
const KEY = 'goserve.active-job';

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

export async function startSharing(orderId) {
  if ((await Location.requestForegroundPermissionsAsync()).status !== 'granted') throw new Error('Location permission is required to share your position.');
  if ((await Location.requestBackgroundPermissionsAsync()).status !== 'granted') throw new Error('Enable background location in device settings to share while navigating.');
  await stopSharing();
  await SecureStore.setItemAsync(KEY, orderId, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  try {
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10,
      showsBackgroundLocationIndicator: true, pausesUpdatesAutomatically: false,
      foregroundService: { notificationTitle: 'GoServe job tracking is on', notificationBody: 'Your location is shared with the customer for your active job.', killServiceOnDestroy: true },
    });
  } catch (error) { await SecureStore.deleteItemAsync(KEY); throw error; }
}
export async function stopSharing() {
  await SecureStore.deleteItemAsync(KEY);
  if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
}
export async function sharingOrder() { return SecureStore.getItemAsync(KEY); }
