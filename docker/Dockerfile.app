# Образ для локального запуску через `docker compose --profile app` (API, relay, consumer).
# Це не production-образ: у ньому dev-залежності (потрібні typeorm CLI для міграцій), і він запускає
# повний Nest-застосунок. Production-образ для кластера: docker/Dockerfile (distroless, HTTP-оболонка).
# Секретів в образі немає: каталог secrets/ у .dockerignore, у контейнер він монтується з хоста.
FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
# робоча копія на Windows має CRLF, а bash у Linux його не розуміє
RUN sed -i 's/\r$//' scripts/*.sh scripts/lib/*.sh && npx tsc

USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
