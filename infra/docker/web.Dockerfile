# The web image: ONE Dockerfile for every browser surface.
#
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=@zipzap/merchant-web .
#
# Context is the REPOSITORY ROOT, for the same reason the backend's is: a pnpm workspace installs
# from the root, and every web app depends on @zipzap/api-client, which is a workspace package.
#
# `APP` and `APP_DIR` must be changed together — there is no way to derive a pnpm package name
# from its directory inside a Dockerfile.
#
# ------------------------------------------------------------------------------------------------
# Why a Node host and not nginx: these apps are server-rendered.
#
# `vite build` for a TanStack Start app does not emit a static site. It emits dist/client (browser
# assets) and dist/server/server.js, whose default export is a *fetch handler*, not an HTTP
# server — something has to own the socket. That something also has to own the `/api` hop, because
# the same-origin proxy is what makes the session cookie first-party (ADR-0016). nginx would mean a
# second process in the container — so a third image or a hand-rolled PID 1 — and it would put the
# proxy's four rules in a file nowhere near the comment explaining why they exist. One file, one
# process, the ADR in the margin.
# ------------------------------------------------------------------------------------------------

# ------------------------------------------------------------------------------------------------
# deps — manifest-only install, cached until the lockfile changes.
# ------------------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps

# Mirrors the root `packageManager` field; see backend.Dockerfile for why it is repeated.
ENV PNPM_VERSION=11.5.0

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    corepack enable && corepack install --global "pnpm@${PNPM_VERSION}" && pnpm --version

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV npm_config_store_dir=/pnpm/store

WORKDIR /srv

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./

# A workspace package missing from this list makes `pnpm install --frozen-lockfile` fail rather
# than produce an install that quietly skipped it.
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

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ------------------------------------------------------------------------------------------------
# build — one app, its workspace dependencies, and the production dependency tree it will run on.
# ------------------------------------------------------------------------------------------------
FROM deps AS build

# The app to build. Every one of them is the same three lines of config apart.
ARG APP=@zipzap/merchant-web
# ...and its directory, which Docker cannot derive from the package name.
ARG APP_DIR=apps/frontends/merchant-web

# Read by the bundle at BUILD time, so a different value means a different image — which is the
# only reason it is an ARG and not a runtime variable. The browser must never learn an API URL;
# this is the build-time half of that rule, the host in infra/docker/web-host.mjs is the rest.
#
# `/api` rather than an absolute URL is the default for ALL apps, including customer-tracking,
# whose `src/lib/api.ts` still reads VITE_API_URL. Pointing it at the proxy means every surface in
# this compose file talks to the backend through its own origin: no CORS, no WEB_ORIGIN entry to
# keep in sync, and one rule to reason about instead of two. Passing an absolute
# `http://host:port` restores the old cross-origin behaviour if you want to see it fail.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

WORKDIR /srv

COPY apps apps
COPY packages packages

# `...` builds workspace dependencies first, which here means @zipzap/api-client: its package.json
# `main` points at dist/, so an app built before it resolves to nothing and typechecks as `any`.
# That package's `generate` reads apps/backend/openapi.json, which is committed — so a web image
# can be built without booting a backend, which is the point of the contract being a file.
#
# The move to /out/app is what lets the runtime stage use one fixed COPY path instead of an ARG,
# which BuildKit expands in COPY sources inconsistently across versions.
RUN mkdir -p /out && pnpm --filter "${APP}..." build && mv "${APP_DIR}/dist" /out/app

# ------------------------------------------------------------------------------------------------
# prod-deps — react, react-dom and @tanstack/react-router are externalised by the server bundle
# (`ssr.noExternal` covers only the workspace packages), so the runtime genuinely needs node_modules.
# `pnpm deploy` emits a hoisted tree that resolves without the workspace around it; --legacy because
# this repo does not enable pnpm's injected-workspace deploy.
# ------------------------------------------------------------------------------------------------
FROM deps AS prod-deps

ARG APP=@zipzap/merchant-web

WORKDIR /srv

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm deploy --filter "${APP}" --prod --legacy /out/app && \
    # deploy copies the whole package directory, and none of this runs. Not worth a .npmignore
    # in apps/frontends/*/ — a build output directory should not be where build configuration
    # lives — so it is deleted here where the reason can be explained.
    rm -rf /out/app/src /out/app/scripts /out/app/.tanstack

# ------------------------------------------------------------------------------------------------
# runtime — the built app, its production dependencies, and the host that serves them.
# ------------------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /srv/app

COPY --from=prod-deps --chown=node:node /out/app/node_modules /srv/app/node_modules
COPY --from=build --chown=node:node /out/app                     /srv/app/dist
COPY --chown=node:node infra/docker/web-host.mjs                   /srv/app/dist/web-host.mjs

# The container listens on the port the host publishes, and that is load-bearing rather than
# conventional: `src/routes/app.tsx`'s server-side guard resolves its relative `/api` base URL
# against the origin the browser used and fetches it back (`new URL(request.url).origin`). The app
# therefore asks ITSELF for /api on the public port, and only this arrangement makes that request
# land. Change the published port in compose and you must change this one with it — which is why
# compose derives both from the same variable instead of hardcoding 8080 here.
ENV PORT=4173
EXPOSE 4173

# The `node` user ships with the base image. Note the consequence of never binding below 1024:
# there is no port to bind, so there is no reason to be root, and no capability to drop.
USER node

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `web-host.mjs` resolves dist/client and dist/server relative to its own file, so the image can be
# moved or the paths changed without editing a line of it.
CMD ["node", "/srv/app/dist/web-host.mjs"]