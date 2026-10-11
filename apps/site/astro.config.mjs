// @ts-check
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

/**
 * ZipZap's documentation site.
 *
 * `site: '/'` and no adapter — this is a static site, and docs are the one surface where
 * server-rendering is a cost with no benefit: nothing here is per-user, and a static build
 * means the whole docs tree is cacheable at the edge and works from a file:// URL.
 *
 * The API reference is the one dynamic part, and it is dynamic *by design*: Stoplight Elements
 * fetches `/openapi.json` in the browser rather than having Astro inline it. That keeps the
 * spec a build artefact rather than a bundled blob, so the contract JSON a client generates
 * and the JSON this document renders are the same bytes.
 */
export default defineConfig({
  site: 'https://docs.zipzap.com',
  // The landing page currently lives in merchant-web, so this package is docs-only and
  // builds to `/` there is no conflict yet. When the marketing page moves here, change
  // `outDir` and let turbo order the two.
  outDir: 'dist',
  vite: {
    // Same integration merchant-web uses. Tailwind v4 needs the plugin rather than a
    // PostCSS entry, and `@source` must name this package's directories or the classes in
    // `src/` are never scanned and the site renders unstyled.
    plugins: [tailwindcss()],
    // Stoplight ships web components whose CSS is injected at runtime; Vite must not try to
    // bundle or tree-shake them, or the import fails on a missing `document`.
    ssr: {
      noExternal: ['@stoplight/elements'],
    },
  },
});
