# syntax=docker/dockerfile:1
FROM oven/bun:1.4.3-slim AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/merchant-web/package.json ./apps/merchant-web/package.json
COPY apps/courier-web/package.json ./apps/courier-web/package.json
COPY apps/dashboard-web/package.json ./apps/dashboard-web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @porden/api --filter @porden/sdk --filter @porden/contracts

FROM oven/bun:1.4.3-slim AS nsdeploy
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY scripts/ensure-nsdeploy.ts ./scripts/ensure-nsdeploy.ts
# Reuse the repository's exact upstream revision; never copy a developer's vendor checkout.
RUN bun scripts/ensure-nsdeploy.ts

FROM oven/bun:1.4.3-slim AS api
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORDEN_HOST=0.0.0.0 \
    NSDEPLOY_RUNTIME_PATH=/app/vendor/nsdeploy/nsdeploy/runtime
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./package.json
COPY packages/contracts ./packages/contracts
COPY packages/sdk ./packages/sdk
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/src ./apps/api/src
COPY apps/api/public ./apps/api/public
COPY apps/api/drizzle ./apps/api/drizzle
COPY public/merchant/merchant.network.json ./public/merchant/merchant.network.json
COPY public/courier/courier.network.json ./public/courier/courier.network.json
COPY --from=nsdeploy /source/vendor/nsdeploy/nsdeploy/runtime ./vendor/nsdeploy/nsdeploy/runtime
COPY infra/standalone/entrypoint.sh infra/standalone/healthcheck.mjs ./infra/standalone/
USER bun
EXPOSE 5300 5100 5200
HEALTHCHECK --interval=15s --timeout=6s --start-period=30s --retries=3 CMD ["bun", "infra/standalone/healthcheck.mjs"]
ENTRYPOINT ["/bin/sh", "/app/infra/standalone/entrypoint.sh"]
CMD ["platform"]
