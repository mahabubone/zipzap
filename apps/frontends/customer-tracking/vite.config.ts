import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // tanstackStart() registers the router plugin, which must precede react() —
  // it resolves /@react-refresh from react() and throws without it.
  plugins: [tanstackStart(), react(), tailwindcss()],
  ssr: { noExternal: ['@zipzap/ui', '@zipzap/api-client'] },
  // Its own port: this app is a separate deployable from the merchant console,
  // so `pnpm dev` must be able to run both at once.
  server: { port: 5174 },
});
