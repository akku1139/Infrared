importScripts('/proxy-url.js');

const PROXY_PREFIX = self.infraredProxy.prefix;
const BARE_ENDPOINT = '/bare/v3';
const passthroughHeaders = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'x-bare-url', 'x-bare-headers']);
const urlAttributes = /\b(?:href|src|action|poster|cite|background|formaction|manifest)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const srcsetAttributes = /\bsrcset\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function isProxyRequest(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(PROXY_PREFIX);
}

function sourceTarget(requestUrl) {
  const source = self.infraredProxy.sourceUrl(requestUrl, self.location.href);
  const target = new URL(source);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('HTTP または HTTPS の URL のみ利用できます。');
  return target;
}

function copyRequestHeaders(request) {
  const headers = {};
  request.headers.forEach((value, key) => {
    if (!passthroughHeaders.has(key)) headers[key] = value;
  });
  if (headers.referer) headers.referer = self.infraredProxy.sourceUrl(headers.referer);
  if (headers.origin && self.infraredProxy.isProxyUrl(headers.origin)) headers.origin = self.location.origin;
  return headers;
}

function rewriteSrcset(value, base) {
  return value.split(',').map((entry) => {
    const match = entry.trim().match(/^(\S+)(.*)$/);
    if (!match) return entry;
    return `${self.infraredProxy.rewriteUrl(match[1], base)}${match[2]}`;
  }).join(', ');
}

function rewriteStyle(value, base) {
  return value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, quote, url) => {
    return `url(${quote}${self.infraredProxy.rewriteUrl(url, base)}${quote})`;
  }).replace(/(@import\s+)(['"])(.*?)\2/gi, (match, start, quote, url) => {
    return `${start}${quote}${self.infraredProxy.rewriteUrl(url, base)}${quote}`;
  });
}

function rewriteHtml(html, base) {
  let output = html.replace(urlAttributes, (match, value, doubleQuoted, singleQuoted, bare) => {
    const original = doubleQuoted ?? singleQuoted ?? bare ?? '';
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
    const rewritten = self.infraredProxy.rewriteUrl(original, base);
    return match.replace(value, `${quote}${rewritten}${quote}`);
  });
  output = output.replace(srcsetAttributes, (match, value, doubleQuoted, singleQuoted, bare) => {
    const original = doubleQuoted ?? singleQuoted ?? bare ?? '';
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
    const rewritten = rewriteSrcset(original, base);
    return match.replace(value, `${quote}${rewritten}${quote}`);
  });
  output = output.replace(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (match, value, doubleQuoted, singleQuoted) => {
    const quote = value[0];
    const original = doubleQuoted ?? singleQuoted ?? '';
    return match.replace(value, `${quote}${rewriteStyle(original, base)}${quote}`);
  });
  output = output.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (match, start, css, end) => `${start}${rewriteStyle(css, base)}${end}`);
  output = output.replace(/(<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url=)([^"']+)/gi, (match, start, url) => `${start}${self.infraredProxy.rewriteUrl(url.trim(), base)}`);
  return output;
}

function rewriteResponseHeaders(headers, target) {
  for (const [key, value] of headers) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'location') headers.set(key, self.infraredProxy.rewriteUrl(value, target.href));
    if (lowerKey === 'refresh') headers.set(key, value.replace(/(url\s*=\s*)([^;]+)/i, (match, start, url) => `${start}${self.infraredProxy.rewriteUrl(url.trim(), target.href)}`));
  }
  headers.set('X-Infrared-Proxy', 'bare-v3');
  return headers;
}

async function proxyRequest(request) {
  const target = sourceTarget(request.url);
  const remoteHeaders = copyRequestHeaders(request);
  const controlHeaders = new Headers({
    'X-Bare-URL': target.href,
    'X-Bare-Headers': JSON.stringify(remoteHeaders),
  });
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  const response = await fetch(new URL(BARE_ENDPOINT, self.location.origin), {
    method: request.method,
    headers: controlHeaders,
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
  const contentType = forwardedHeaders.get('content-type') || '';
  if (contentType.includes('text/css')) {
    const text = await response.text();
    const rewritten = rewriteStyle(text, target.href);
    forwardedHeaders.delete('content-length');
    forwardedHeaders.delete('content-encoding');
    rewriteResponseHeaders(forwardedHeaders, target);
    return new Response(rewritten, { status, statusText, headers: forwardedHeaders });
  }
  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
    const text = await response.text();
    const rewritten = rewriteHtml(text, target.href);
    forwardedHeaders.delete('content-length');
    forwardedHeaders.delete('content-encoding');
    forwardedHeaders.set('content-type', 'text/html; charset=utf-8');
    rewriteResponseHeaders(forwardedHeaders, target);
    return new Response(rewritten, { status, statusText, headers: forwardedHeaders });
  }
  rewriteResponseHeaders(forwardedHeaders, target);
  return new Response(status === 304 ? null : response.body, { status, statusText, headers: forwardedHeaders });
}

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (!isProxyRequest(requestUrl)) return;
  event.respondWith(proxyRequest(event.request).catch((error) => new Response(error.message, {
    status: 502,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })));
});
