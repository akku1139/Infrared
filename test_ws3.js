import { Miniflare } from 'miniflare';

const mf = new Miniflare({
  name: 'infrared-test',
  scriptPath: './public/_worker.js',
  compatibilityDate: '2024-01-01',
  compatibilityFlags: ['nodejs_compat'],
  modules: true,
});

try {
  // Test with OPTIONS first
  const optionsResponse = await mf.dispatchFetch('http://localhost:8787/v3/', {
    method: 'OPTIONS',
  });
  console.log('OPTIONS Status:', optionsResponse.status);
  
  // Now try WebSocket upgrade
  const response = await mf.dispatchFetch('http://localhost:8787/v3/', {
    headers: {
      'upgrade': 'websocket',
    },
  });
  
  console.log('WebSocket Status:', response.status);
  console.log('Expected: 101');
  console.log('Has WebSocket:', !!response.webSocket);
} catch (e) {
  console.error('Error:', e.message);
  console.error(e.stack);
} finally {
  await mf.dispose();
}
