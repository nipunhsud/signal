FROM node:20-alpine AS base
WORKDIR /app

RUN apk add --no-cache openssl
# Pinned to the version that wrote pnpm-lock.yaml (see apps/breakout-agent/Dockerfile).
RUN npm install -g pnpm@9.15.9

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/trading-agent/ apps/trading-agent/
# breakout-agent's manifest only: the lockfile lists every workspace importer
COPY apps/breakout-agent/package.json apps/breakout-agent/package.json
COPY prisma/ prisma/

RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate
RUN pnpm -F trading-agent build

FROM base AS trader
WORKDIR /app/apps/trading-agent
CMD ["node", "dist/index.js"]
