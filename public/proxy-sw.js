const PROXY_PATH = '/__infrared_proxy';
const BARE_ENDPOINT = '/bare/v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function isProxyRequest(url) {
  return url.pathname === PROXY_PATH;
}

function parseTarget(requestUrl) {
  const target = new URL(requestUrl).searchParams.get('url');
  if (!target) throw new Error('プロキシ対象 URL がありません。');
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP または HTTPS の URL のみ利用できます。');
  return url;
}

function copyRequestHeaders(request) {
  const headers = {};
  request.headers.forEach((value, key) => {
    if (!['host', 'connection', 'content-length', 'transfer-encoding', 'x-bare-url', 'x-bare-headers'].includes(key)) {
      headers[key] = value;
    }
  });
  return headers;
}

async function proxyRequest(request) {
  const target = parseTarget(request.url);
  const remoteHeaders = copyRequestHeaders(request);
  const headers = new Headers({
    'X-Bare-URL': target.toString(),
    'X-Bare-Headers': JSON.stringify(remoteHeaders),
  });
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  const response = await fetch(new URL(BARE_ENDPOINT, self.location.origin), {
    method: request.method,
    headers,
    body,
  });
  const status = Number(response.headers.get('X-Bare-Status')) || response.status;
  const statusText = response.headers.get('X-Bare-Status-Text') || undefined;
  const forwardedHeaders = new Headers();
  const rawHeaders = response.headers.get('X-Bare-Headers');
  if (rawHeaders) {
    const parsedHeaders = JSON.parse(rawHeaders);
    Object.entries(parsedHeaders).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach((item) => forwardedHeaders.append(key, item));
      else forwardedHeaders.set(key, value);
    });
  }
  if (status !== 304) {
    forwardedHeaders.set('X-Infrared-Proxy', 'bare-v3');
  }
  return new Response(status === 304 ? null : response.body, { status, statusText, headers: forwardedHeaders });
}

self.addEventListener('fetch', (event) => {
  if (!isProxyRequest(new URL(event.request.url))) return;
  event.respondWith(proxyRequest(event.request).catch((error) => new Response(error.message, {
    status: 502,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })));
});
