# syntax = docker/dockerfile:1
# Builds the game with Vite, then runs the Node game server, which serves the built files,
# the lobby and live matches. Build context is the repo root: docker build -f deploy/Dockerfile .

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# the commit shown on the main menu; Coolify passes it when "Include Source Commit in Build" is on,
# otherwise the build reads it from .git (src/build_version.ts)
ARG SOURCE_COMMIT
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production SERVER_PORT=8080 STATIC_DIR=/app/dist
# Coolify's health check runs curl or wget inside the container, and the slim image has neither
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# the server runs the same game engine as the browser, straight from TypeScript
COPY src ./src
COPY server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/main.ts"]
