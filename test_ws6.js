import { Miniflare } from 'miniflare';

const mf = new Miniflare({
  name: 'infrared-test',
  scriptPath: './public/_worker.js',
  compatibilityDate: '2024-01-01',
  compatibilityFlags: ['nodejs_compat'],
  modules: true,
});

try {
  // Test with WebSocket upgrade - use POST to trigger tunnelRequest instead of route matching issue
  const response = await mf.dispatchFetch('http://localhost:8787/v3/', {
    method: 'POST',
    headers: {
      'upgrade': 'websocket',
      'x-bare-url': 'https://example.com',
      'x-bare-headers': '{}',
    },
  });
  
  console.log('Status:', response.status);
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await mf.dispose();
}
