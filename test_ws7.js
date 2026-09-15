import { Miniflare } from 'miniflare';

const mf = new Miniflare({
  name: 'infrared-test',
  scriptPath: './public/_worker.js',
  compatibilityDate: '2024-01-01',
  compatibilityFlags: ['nodejs_compat'],
  modules: true,
});

try {
  // Debug - check what the request looks like
  const url = 'http://localhost:8787/v3/';
  console.log('Testing URL:', url);
  console.log('Parsed path:', new URL(url).pathname);
  
  const response = await mf.dispatchFetch(url, {
    method: 'GET',
    headers: {
      'upgrade': 'websocket',
    },
  });
  
  console.log('Status:', response.status);
  console.log('Headers:', [...response.headers.entries()]);
} catch (e) {
  console.error('Error:', e.message);
  console.error(e.stack);
} finally {
  await mf.dispose();
}
