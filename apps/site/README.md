# apps/site

ZipZap's documentation site. Astro + Tailwind v4, with the API reference rendered by Stoplight
Elements.

```
pnpm docs:dev      # http://localhost:4321
pnpm docs:build
```

## The one rule

**The API reference is generated, never written.** `scripts/sync-openapi.mjs` copies the backend's
`openapi.json` into `public/` before the build, and `<elements-api>` fetches it in the browser. The
spec is a build artefact derived from the controller decorators — editing anything here to change
what the API reference says would make the docs and the server disagree.

If `openapi.json` is missing, the sync script **fails the build** rather than falling back to a
stale copy. A docs site serving a last-known-good contract is worse than one that does not build.

The pages under `/api-reference/` are one per `@ApiTags` group, enumerated from that same spec, so
the tag list and the endpoint list cannot drift.

## Layout

```
src/
  pages/
    index.astro                       catalog tiles
    api-reference/[...path].astro     one page per tag, Stoplight SPA
    <catalog>/index.astro             a catalog's landing page
    <catalog>/[...slug].astro         one page per markdown file
  content/<catalog>/*.md              the prose
  components/
    Base.astro                        shell, nav, and the Stoplight registration
    DocPage.astro                     sidebar + prose styles
    CatalogIndex.astro                a catalog's listing
    ApiReference.astro                <elements-api>
scripts/sync-openapi.mjs              copies the spec, fails if absent or truncated
```

## Two things that will bite

1. **`getStaticPaths` runs in an isolated module context.** It cannot call a helper defined at the
   top of the same file — the helper is `undefined` there, and the build fails with a bare
   `tagsFromSpec is not defined` that names nothing you can search for. Everything it needs is
   inlined.
2. **`@stoplight/elements` must be imported as `/web-components.min.js`.** The package declares its
   side effects only for that subpath, so the bare import is tree-shaken out: the script ships, the
   custom-element registration does not, and `<elements-api>` renders nothing. See `Base.astro`.
