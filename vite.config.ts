import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built app works from any folder served by `vite preview`.
  base: './',
  server: {
    open: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
