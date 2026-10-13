import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'ES2020',
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
      fileName: () => 'main.js',
    },
    outDir: 'dist',
    rollupOptions: {
      external: ['electron'],
    },
  },
});
