FROM node:20-alpine AS base
WORKDIR /app

# Install system dependencies (OpenSSL for Prisma; Inter + fontconfig so
# resvg's system-font path can render OG-card text even if buffer loading
# misbehaves on musl)
RUN apk add --no-cache openssl fontconfig font-inter

# Install pnpm
RUN npm install -g pnpm

# Copy monorepo files
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
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
COPY apps/breakout-agent/entrypoint.sh /app/apps/breakout-agent/
RUN chmod +x /app/apps/breakout-agent/entrypoint.sh
ENTRYPOINT ["/app/apps/breakout-agent/entrypoint.sh"]
