import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

const isWeb = Platform.OS === 'web';
let memoryToken = null;

async function getStoredToken() {
  if (isWeb) {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem('goserve.session') : memoryToken; } catch { return memoryToken; }
  }
  try {
    return await SecureStore.getItemAsync('goserve.session');
  } catch {
    return null;
  }
}

export async function request(route, data, explicitToken) {
  const token = explicitToken ?? await getStoredToken();
  const response = await fetch(`${API_URL}/api${route}`, {
    method: data ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      Origin: new URL(API_URL).origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status });
  return body;
}

export async function saveSession(token) {
  if (!token) throw new Error('The server did not return a mobile session.');
  if (isWeb) {
    memoryToken = token;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('goserve.session', token); } catch {}
    return;
  }
  await SecureStore.setItemAsync('goserve.session', token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}

export async function clearSession() {
  if (isWeb) {
    memoryToken = null;
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem('goserve.session'); } catch {}
    return;
  }
  await SecureStore.deleteItemAsync('goserve.session');
}
