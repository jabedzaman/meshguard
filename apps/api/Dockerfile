# syntax=docker/dockerfile:1.7
# Production image. Build context is the repo root:
#   docker build -f apps/api/Dockerfile .
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile \
    --filter @meshguard/api... \
    --filter meshguard
ENV NODE_ENV=production
RUN pnpm turbo run build --filter=@meshguard/api...
# Self-contained copy of the app with prod deps and built workspace packages.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @meshguard/api deploy --prod /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "dist/index.js"]
