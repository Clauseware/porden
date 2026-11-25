# syntax=docker/dockerfile:1
# One image definition for the three Next.js sites. APP selects merchant-web, courier-web or
# dashboard-web. Caddy sends API, discovery and runtime paths straight to the APIs; these images
# serve only pages. The internal origins are build-time fallbacks for the apps' own rewrites.
FROM oven/bun:1.4.3-slim AS bun

FROM node:22-bookworm-slim AS build
ARG APP
ARG API_INTERNAL_ORIGIN=
ARG PORDEN_API_INTERNAL_ORIGIN=http://platform:5300
RUN test -n "$APP" || (echo "APP build argument is required" >&2; exit 1)
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/merchant-web/package.json ./apps/merchant-web/package.json
COPY apps/courier-web/package.json ./apps/courier-web/package.json
COPY apps/dashboard-web/package.json ./apps/dashboard-web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
RUN bun install --frozen-lockfile --ignore-scripts
COPY packages ./packages
COPY apps/brand.css apps/logo.tsx apps/task-consumer.tsx apps/task-consumer.css ./apps/
COPY apps/${APP} ./apps/${APP}
ENV NEXT_TELEMETRY_DISABLED=1
RUN API_INTERNAL_ORIGIN="$API_INTERNAL_ORIGIN" PORDEN_API_INTERNAL_ORIGIN="$PORDEN_API_INTERNAL_ORIGIN" \
    node node_modules/next/dist/bin/next build "apps/${APP}"

FROM node:22-bookworm-slim AS web
ARG APP
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    APP=${APP}
WORKDIR /app
COPY --from=build /app /app
COPY LICENSE NOTICE ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=6s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start \"apps/$APP\" -p 3000 -H 0.0.0.0"]
