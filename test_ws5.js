import { Miniflare } from 'miniflare';

const mf = new Miniflare({
  name: 'infrared-test',
  scriptPath: './public/_worker.js',
  compatibilityDate: '2024-01-01',
  compatibilityFlags: ['nodejs_compat'],
  modules: true,
});

try {
  // Test with WebSocket upgrade to v3 without trailing slash
  const response = await mf.dispatchFetch('http://localhost:8787/v3', {
    headers: {
      'upgrade': 'websocket',
    },
  });
  
  console.log('Status:', response.status);
  console.log('Expected: 101');
  console.log('Has WebSocket:', !!response.webSocket);
} catch (e) {
  console.error('Error:', e.message);
  console.error(e.stack);
} finally {
  await mf.dispose();
}
