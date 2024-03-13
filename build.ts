await Bun.$`mkdir -p dist`;

const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: 'dist',
  splitting: false,
  minify: true,
});

if (!result.success) {
  throw new Error('Build failed');
}

await Bun.$`mv dist/index.js dist/_worker.js`;

await Bun.$`cp -r static/* dist`;
