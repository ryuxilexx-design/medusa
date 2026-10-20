# Med.uz.ai production image: web (Next.js) + API (NestJS) in one container, like the Railway demo.
# Only the web port is exposed; the API listens on 127.0.0.1 inside the container and is reached through
# the web server's /api/v1 proxy. Migrations run when the API starts.
#
#   docker build -t meduzai:latest .
#   (see deploy/docker-compose.prod.yml and docs/DEPLOY_UZ.md)

FROM node:22.12.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# dependency layer first, so code changes do not reinstall node_modules
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY database/package.json database/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22.12.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOST=0.0.0.0 PORT=3000 TZ=UTC
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "run", "start"]
