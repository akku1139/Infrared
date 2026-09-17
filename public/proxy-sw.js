/*global UVServiceWorker*/

importScripts('/uv/uv.bundle.js');
importScripts('/uv/uv.config.js');
importScripts('/uv/uv.sw.js');

const ultraviolet = new UVServiceWorker();

self.addEventListener('fetch', (event) => {
  event.respondWith(
    ultraviolet.route(event)
      ? ultraviolet.fetch(event)
      : fetch(event.request)
  );
});
