import { defineConfig } from 'vite';
import { audioManifest } from './vite-plugins/audioManifest';

export default defineConfig({
  // Relative base so the built app works from any folder served by `vite preview`.
  base: './',
  plugins: [audioManifest()],
  server: {
    open: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
