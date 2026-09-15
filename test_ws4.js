import { Miniflare } from 'miniflare';

const mf = new Miniflare({
  name: 'infrared-test',
  scriptPath: './public/_worker.js',
  compatibilityDate: '2024-01-01',
  compatibilityFlags: ['nodejs_compat'],
  modules: true,
});

try {
  // Test path resolution
  const response1 = await mf.dispatchFetch('http://localhost:8787/', {
    method: 'GET',
  });
  console.log('Root Status:', response1.status);
  
  const response2 = await mf.dispatchFetch('http://localhost:8787/v3', {
    method: 'OPTIONS',
  });
  console.log('v3 (no trailing slash) OPTIONS Status:', response2.status);
  
  const response3 = await mf.dispatchFetch('http://localhost:8787/v3/', {
    method: 'OPTIONS',
  });
  console.log('v3/ (with trailing slash) OPTIONS Status:', response3.status);
  
} catch (e) {
  console.error('Error:', e.message);
  console.error(e.stack);
} finally {
  await mf.dispose();
}
