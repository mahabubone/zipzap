# apps/mobile-rider

The rider app — Expo / React Native, offline-first.

```
pnpm --filter @zipzap/rider dev        # Expo dev server
pnpm --filter @zipzap/rider test       # 25 tests
pnpm --filter @zipzap/rider verify:queue
pnpm --filter @zipzap/rider verify:client
```

`EXPO_PUBLIC_API_URL` in `.env` (see `.env.example`).

## `build` is web-only, deliberately

`build` runs `expo export --platform web`. It bundles and serves the app in a browser, which is what
the screenshot script and any smoke test need.

**Native (`ios`, `android`) does not bundle here.** `expo export --platform ios` fails inside
`react-native-screens` with `Unknown prop type for "type": "undefined"` — the Fabric
`ScreenStackHeaderSubviewNativeComponent` ships TypeScript source that `babel-preset-expo` cannot
type, and fixing it means a react-native codegen setup that an Expo Go workflow does not provide.
`react-native-screens` arrived with the React Navigation migration, so this is a consequence of that
change and is recorded rather than hidden.

Consequences:

- A native build needs `expo prebuild` (which generates the native projects) and a device or an EAS
  config, both of which are outside what this environment can produce — see plan decision D4, which
  deliberately excluded store signing and EAS submit.
- `pnpm run build` at the repo root builds **web** for this package, which is the artifact the
  shots script exercises. `verify` does not run `build`, and `typecheck` does — so the app's types
  are still checked on every commit even though the native bundle does not exist.
- Native runtime behaviour is unverified. The offline queue's guarantees are covered by
  `command-queue.spec.ts` against the real storage port, so the logic is tested; the integration of
  that port with AsyncStorage on a device is not.
