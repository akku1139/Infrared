const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: 'public',
  naming: "[dir]/_worker.js",
  splitting: false,
  minify: true,
});

if (!result.success) {
  throw new Error('Build failed');
}
