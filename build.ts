import * as esbuild from 'esbuild';

const isProduction = false;

async function build() {
  try {
    await esbuild.build({
      entryPoints: ['./src/index.ts'],
      outfile: './public/_worker.js',
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2022'],
      minify: isProduction,
      sourcemap: !isProduction,
      keepNames: true,
    });
    
    console.log('Build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
  }
}

build();
