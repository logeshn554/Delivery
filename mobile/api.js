import * as SecureStore from 'expo-secure-store';
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
export async function request(route, data, explicitToken) {
  const token = explicitToken ?? await SecureStore.getItemAsync('goserve.session');
  const response = await fetch(`${API_URL}/api${route}`, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Origin: new URL(API_URL).origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status });
  return body;
}
export async function saveSession(token) {
  if (!token) throw new Error('The server did not return a mobile session.');
  await SecureStore.setItemAsync('goserve.session', token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}
export async function clearSession() { await SecureStore.deleteItemAsync('goserve.session'); }
