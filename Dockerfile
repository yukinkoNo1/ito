# syntax=docker/dockerfile:1
# いと — マルチステージ（SPEC §20）。ビルドも実行も node:24-slim

FROM node:24-slim AS build
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable
# 依存だけ先に入れる（ソースを変えても再利用できるように）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# 実行時に要る依存は better-sqlite3 だけ（ほかはサーバーのバンドルに入っている）
RUN pnpm --filter @ito/server deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist ./public
RUN mkdir -p /data/backups && chown -R 10001:10001 /data
USER 10001
CMD ["node", "dist/server.js"]
