import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.APP_BASE_PATH || '/',
  build: { target: 'es2022', sourcemap: false, manifest: 'asset-manifest.json' },
  server: { host: '127.0.0.1' },
});
