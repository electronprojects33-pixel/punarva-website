import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // Exposes to local network for testing on mobile device/tablets
    port: 5173,
    watch: {
      usePolling: true,
      interval: 1000,
      ignored: ['**/public/models/**', '**/.git/**']
    },
    headers: {
      // Required for SharedArrayBuffer / WebAssembly high-performance threading if needed
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless'
    }
  },
  preview: {
    host: true,
    port: 4173
  }
});
