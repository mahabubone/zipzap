import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart()],
  ssr: { noExternal: ['@zipzap/ui', '@zipzap/api-client'] },
});
