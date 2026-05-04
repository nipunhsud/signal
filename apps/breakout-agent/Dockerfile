FROM node:20-alpine AS base
WORKDIR /app

# Install system dependencies (OpenSSL for Prisma)
RUN apk add --no-cache openssl

# Install pnpm
RUN npm install -g pnpm

# Copy monorepo files
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/ packages/
COPY apps/breakout-agent/ apps/breakout-agent/
COPY prisma/ prisma/
COPY scripts/ scripts/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm exec prisma generate

# Build
RUN pnpm -F breakout-agent build

# Agent stage
FROM base AS agent
WORKDIR /app/apps/breakout-agent
CMD ["node", "dist/index.js"]

# Dashboard stage
FROM base AS dashboard
WORKDIR /app/apps/breakout-agent
EXPOSE 3000
CMD ["node", "server.js"]
