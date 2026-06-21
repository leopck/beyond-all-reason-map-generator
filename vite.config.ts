import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    // Keep WASM assets and large bundles healthy
    chunkSizeWarningLimit: 4096,
  },
  server: {
    host: true,
    port: 5173,
  },
});
