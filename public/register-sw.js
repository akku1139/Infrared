function waitForServiceWorkerControl() {
  if (navigator.serviceWorker.controller) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      reject(new Error('Service Worker がページを制御できませんでした。'));
    }, 8000);
    const onControllerChange = () => {
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      resolve();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  });
}

async function registerInfraredServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('このブラウザは Service Worker に対応していません。');
  }
  await navigator.serviceWorker.register('/proxy-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  await waitForServiceWorkerControl();
}

window.infraredServiceWorker = registerInfraredServiceWorker();
