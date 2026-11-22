# syntax = docker/dockerfile:1
# Builds the game with Vite, then runs the Node game server, which serves the built files,
# the lobby and live matches. Build context is the repo root: docker build -f deploy/Dockerfile .

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production SERVER_PORT=8080 STATIC_DIR=/app/dist
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
