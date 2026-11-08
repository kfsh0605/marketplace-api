FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_token,required=true \
    --mount=type=bind,source=docker/npmrc,target=/tmp/npmrc \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" npm ci --userconfig /tmp/npmrc
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_token,required=true \
    --mount=type=bind,source=docker/npmrc,target=/tmp/npmrc \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" npm ci --omit=dev --userconfig /tmp/npmrc

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER 65532:65532
EXPOSE 3000
CMD ["dist/k8s/server.js"]