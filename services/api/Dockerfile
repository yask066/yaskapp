FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/api/package.json services/api/package.json

RUN npm ci

COPY packages/shared packages/shared
COPY services/api services/api

RUN npm run build -w @yaskapp/shared
RUN npm run build -w @yaskapp/api

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/api/package.json services/api/package.json

RUN npm ci --omit=dev

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/services/api/dist services/api/dist
COPY --from=build /app/services/api/src/db/migrations services/api/dist/db/migrations

USER node
EXPOSE 3000

CMD ["node", "services/api/dist/server.js"]
