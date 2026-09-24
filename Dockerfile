# Fire Drake room server. Built and run on Fly.io; see fly.toml.
#
# Build stage compiles the server bundle from the same sources the client
# uses. The runtime stage carries only Node, the bundle and `ws`.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY server ./server
RUN npm run server:build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
RUN npm install --no-save --no-package-lock ws@8.21.3
COPY --from=build /app/dist-server ./dist-server
EXPOSE 8080
CMD ["node", "--enable-source-maps", "--disable-warning=ExperimentalWarning", "dist-server/index.js"]
