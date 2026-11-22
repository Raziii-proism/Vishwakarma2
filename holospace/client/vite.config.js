import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    host: true,
    port: 5173,
    https: false, // Set to true with cert files for WebXR on physical devices
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  optimizeDeps: {
    include: ['three', 'socket.io-client'],
  },
});
