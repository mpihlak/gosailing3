# The regatta server and the robot sailors, one image each:
#
#   docker buildx build --platform linux/amd64 --target server -t mpihlak/gosailing-server .
#   docker buildx build --platform linux/amd64 --target ai -t mpihlak/gosailing-ai .
#
# The build stage runs on the builder's own platform: its output is plain JavaScript
# that runs on any of them, so there is nothing to emulate.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:server && npm run build:ai

FROM node:22-alpine AS server
WORKDIR /app
COPY --from=build /src/dist-server/main.js .
ENV PORT=8080 GOSAILING_LOGS=/data/logs
RUN mkdir -p /data/logs && chown node:node /data/logs
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=2s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "main.js"]

FROM node:22-alpine AS ai
WORKDIR /app
COPY --from=build /src/dist-ai/main.js .
USER node
ENTRYPOINT ["node", "main.js"]
CMD ["ws://server:8080", "--count", "2"]
