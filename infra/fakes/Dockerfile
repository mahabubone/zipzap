# Local provider fakes. Dev and CI only — never deployed.
# Build context is infra/fakes; workspace root is mounted read-only for node_modules.
FROM node:24-alpine

WORKDIR /srv/fakes

# The fakes are the whole app; only its own deps are needed.
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --no-frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

EXPOSE 4010
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4010/_healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-transform-types", "src/server.ts"]
