# The backend image: one image, three entrypoints.
#
#   docker build -f infra/docker/backend.Dockerfile .
#
# Context is the REPOSITORY ROOT. A pnpm workspace cannot be installed from a subdirectory, so
# every app, package and the lockfile have to be reachable from here — see .dockerignore for what
# that costs and what is excluded.
#
# There is no CMD. `ENTRYPOINT ["node"]` means the image runs any of the three entrypoints and the
# choice is made by whoever starts the container, which is the whole point of the architecture:
#
#   node apps/backend/dist/main.js        API        :3000
#   node apps/backend/dist/worker.js      worker     :9090 (metrics only)
#   node apps/backend/dist/publisher.js   publisher  :9091 (metrics only)
#
# Baking one in as CMD would make the other two unreachable without `--entrypoint`, and a default
# of `main.js` would quietly start an API in a container meant to be the publisher.

# ---------------------------------------------------------------------------------------------
# deps — the manifest-only install. Its own stage so a source edit does not re-resolve 1,800
# packages; only a lockfile change invalidates it.
# ---------------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps

# The version is repeated from the root `packageManager` field on purpose. corepack reads that
# field only in a directory that contains package.json, and this stage copies the manifests below
# *after* this line — so pinning here is what makes the resolution reproducible, and a mismatch
# between the two is caught by `pnpm install --frozen-lockfile` rather than by a surprise.
ENV PNPM_VERSION=11.5.0

# `--mount=type=cache` keeps the content-addressable store between builds. It is a cache, never a
# layer: the packages are hard-linked into node_modules, so the image is reproducible from the
# lockfile alone even when the store is empty.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    corepack enable && corepack install --global "pnpm@${PNPM_VERSION}" && pnpm --version

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV npm_config_store_dir=/pnpm/store

WORKDIR /srv

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Every workspace manifest, and nothing else. Adding a package without adding its manifest here
# makes `pnpm install --frozen-lockfile` fail on the lockfile/workspace mismatch rather than
# silently producing an install that is missing it — a build that stops is the acceptable outcome,
# a build that quietly skips a workspace dependency is not.
COPY apps/backend/package.json            apps/backend/
COPY apps/frontends/control-tower/package.json    apps/frontends/control-tower/
COPY apps/frontends/customer-tracking/package.json apps/frontends/customer-tracking/
COPY apps/frontends/hub-console/package.json       apps/frontends/hub-console/
COPY apps/frontends/merchant-web/package.json      apps/frontends/merchant-web/
COPY apps/mobile-rider/package.json       apps/mobile-rider/
COPY apps/site/package.json               apps/site/
COPY infra/fakes/package.json             infra/fakes/
COPY packages/api-client/package.json     packages/api-client/
COPY packages/ui/package.json             packages/ui/

# `--frozen-lockfile` is the whole reason this file exists as a layer: it fails the build when the
# lockfile and the manifests disagree, instead of resolving a different tree than the one CI tested.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------------------------
# build — sources in, dist/ out. Full dependency install including devDependencies, because
# `nest build` is a devDependency and the whole toolchain is needed here and nowhere else.
# ---------------------------------------------------------------------------------------------
FROM deps AS build

WORKDIR /srv

COPY tsconfig.base.json ./
COPY apps/backend apps/backend
# Not needed by today's build, and deliberately present anyway: the moment the backend imports a
# workspace package this stops being belt-and-braces, and forgetting the line would fail the build
# in a way that reads like a missing dependency rather than a missing COPY.
COPY packages packages

# `...` is the dependency suffix: the backend plus every workspace package it depends on, built
# first. The backend declares none today, but the flag costs nothing and the day it imports
# @zipzap/ui the image is already correct.
#
# turbo is deliberately not used. Its `globalDependencies` and task graph want every workspace
# present, and this image has no reason to hold a package it does not ship.
RUN pnpm --filter @zipzap/backend... build

# ---------------------------------------------------------------------------------------------
# prod-deps — a self-contained production node_modules for the backend alone.
# ---------------------------------------------------------------------------------------------
# `pnpm deploy` rather than `pnpm install --prod` because the workspace layout pnpm produces
# (symlinks into a root .pnpm store) only resolves from inside the workspace; deploy emits a
# hoisted, portable tree that needs nothing else in the image. `--legacy` because pnpm 10+
# defaults to the injected-workspace implementation and this repo does not enable it.
FROM deps AS prod-deps

WORKDIR /srv

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm deploy --filter @zipzap/backend --prod --legacy /out/backend

# ---------------------------------------------------------------------------------------------
# runtime — dist/, production dependencies, and nothing that can compile.
# ---------------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /srv

COPY --from=prod-deps --chown=node:node /out/backend /srv/apps/backend

# `scripts/` is not optional. `dist/database/cli.js` seeds by dynamically importing
# `../../scripts/seed.mjs`, which in turn reaches back into `../dist/common/secret.js` — so migrate
# and seed need the tree around dist/, not just dist/ itself.
COPY --from=build --chown=node:node /srv/apps/backend/dist    /srv/apps/backend/dist
COPY --from=build --chown=node:node /srv/apps/backend/scripts /srv/apps/backend/scripts

# The `node` user ships with the base image (uid 1000). Nothing in the image is written at
# runtime — `synchronize` is false forever and every schema change is a migration — so the process
# needs no write access to its own code, and root buys nothing here.
USER node

EXPOSE 3000 9090 9091

# Liveness, not readiness. `/healthz` checks nothing on purpose
# (apps/backend/src/health/health.controller.ts): a Postgres blip must not restart every process
# at once. Readiness is `/readyz`, and that is what the compose file uses when it needs to know
# "can this serve traffic yet" rather than "is this process alive".
#
# This check is correct for `main.js` and meaningless for the other two entrypoints — the worker
# and publisher expose only `/metrics`, so this probe would fail them forever. The compose file
# disables it there with `healthcheck: {disable: true}`, which is why it lives in the image at all:
# a bare `docker run` of the API should report its own health without compose.
#
# `node -e` rather than curl/wget: bookworm-slim has neither, and a probe that needs a package the
# runtime does not install is a probe that breaks the next time someone trims the base image.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node`, not `npm run start:api`. The npm scripts pass `--env-file-if-exists=../../.env`, which
# is right for a checkout and wrong for a container: configuration belongs in the environment, and
# a container that silently reads a file baked beside it is a container whose behaviour depends on
# an artefact nobody remembers copying.
ENTRYPOINT ["node"]

# No CMD on purpose — see the header. `node apps/backend/dist/main.js` is the API.