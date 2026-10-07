/** Transport-neutral client: web cookies or native bearer credentials. */
export function createApiClient({baseUrl, getToken = async () => null, fetchImpl = fetch}) {
  return async function request(route, {method = 'GET', body, signal} = {}) {
    if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Expected an API-relative path.');
    const token = await getToken();
    const headers = {Accept:'application/json'};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/v1${route}`, {method, headers, credentials:'include', signal, body:body === undefined ? undefined : JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed.'), {status:response.status});
    return result;
  };
}
