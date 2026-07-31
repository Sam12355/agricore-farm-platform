# AgriCore API image.
#
# Multi-stage, so the runtime image carries no compiler, no source and no dev
# dependencies. The result is a smaller image and, more usefully, a much smaller set of
# things that can be exploited in a running container.

# ---- Stage 1: install dependencies ------------------------------------------------
FROM node:25-alpine AS deps

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo

# Only the manifests first. This layer is cached until a dependency actually changes,
# so a code-only edit does not reinstall the world.
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared-types/package.json  packages/shared-types/
COPY packages/contracts/package.json     packages/contracts/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/test-fixtures/package.json packages/test-fixtures/
COPY apps/api/package.json               apps/api/

RUN pnpm install --frozen-lockfile=false

# ---- Stage 2: build ----------------------------------------------------------------
FROM deps AS build
WORKDIR /repo

COPY packages/ packages/
COPY apps/api/ apps/api/
COPY tsconfig.base.json ./

RUN pnpm --filter "./packages/**" -r build \
 && pnpm --filter @agricore/api build \
 && pnpm prune --prod

# ---- Stage 3: runtime --------------------------------------------------------------
FROM node:25-alpine AS runtime

# Alpine ships a node user already; use it rather than creating another. Running as
# root inside a container is the default nobody should accept.
ENV NODE_ENV=production
WORKDIR /app

# dumb-init reaps zombies and forwards SIGTERM properly, which is what makes graceful
# shutdown work. Without a real init, Node as PID 1 ignores the signal that ECS sends.
RUN apk add --no-cache dumb-init tini

COPY --from=build --chown=node:node /repo/node_modules            ./node_modules
COPY --from=build --chown=node:node /repo/packages                ./packages
COPY --from=build --chown=node:node /repo/apps/api/node_modules   ./apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist           ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/migrations     ./apps/api/migrations
COPY --from=build --chown=node:node /repo/apps/api/package.json   ./apps/api/

USER node
EXPOSE 3001

# The container healthcheck hits liveness, not readiness. Readiness is the load
# balancer's question; restarting a task because its database blipped turns a
# recoverable failure into an outage.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
