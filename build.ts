import * as esbuild from 'esbuild';
import { mkdirSync, cpSync } from 'fs';

const isProduction = false;

async function build() {
  try {
    // Ensure dist directory exists
    mkdirSync('./dist', { recursive: true });
    
    await esbuild.build({
      entryPoints: ['./src/index.ts'],
      outfile: './dist/_worker.js',
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2022'],
      minify: isProduction,
      sourcemap: !isProduction,
      keepNames: true,
      external: ["cloudflare:sockets"],
    });
    
    // Copy public directory to dist
    cpSync('./public', './dist', { recursive: true });
    
    console.log('Build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
  }
}

build();
