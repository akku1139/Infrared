// Test path parsing logic
const testPaths = [
  'http://localhost:8787/',
  'http://localhost:8787/v3',
  'http://localhost:8787/v3/',
  'http://localhost:8787/v3/something',
];

for (const url of testPaths) {
  const path = new URL(url).pathname.split('/').filter(Boolean).slice(1).join('/');
  console.log(`URL: ${url} => path: "${path}"`);
}
