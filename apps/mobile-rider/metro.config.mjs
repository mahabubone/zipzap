/**
 * Metro config for the rider app. `.mjs`, so it imports no matter what `type` the package sets.
 *
 * `watchFolders` lists the workspace root because in a pnpm monorepo the linked `@zipzap/api-client`
 * lives there rather than inside this app's `node_modules`, and Metro would otherwise never see a
 * file change in packages/api-client — so a client rebuild would need a restart rather than a reload.
 *
 * `sourceExts` is NOT extended. Adding `cjs`/`mjs` here makes Metro resolve `expo`'s package entry
 * differently and knocks the whole app off its `AppEntry.js`, which fails as
 * "Unable to resolve module ../../App" — a resolver error that names a directory that plainly
 * exists. The defaults are correct; only the watch folder was ever needed.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultConfig } from 'expo/metro-config';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The monorepo root, not the app directory. */
const workspaceRoot = path.resolve(here, '../../..');

const config = getDefaultConfig(here);

config.watchFolders = [workspaceRoot];

export default config;
