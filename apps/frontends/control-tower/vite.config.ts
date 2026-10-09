import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // tanstackStart() registers the router plugin, which must precede react() —
  // it resolves /@react-refresh from react() and throws without it.
  plugins: [tanstackStart(), react(), tailwindcss()],
  ssr: { noExternal: ['@zipzap/ui', '@zipzap/api-client'] },
});
