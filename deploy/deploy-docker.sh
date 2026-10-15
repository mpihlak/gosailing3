#!/usr/bin/env bash
#
# Builds the server and robot images, pushes them to Docker Hub, and starts them on the
# host with docker compose.
#
#   ./deploy/deploy-docker.sh [server|ai|all] [user@host]
#
# Each image is tagged with the commit it was built from as well as latest, so an older
# build can be run again with SERVER_TAG or AI_TAG in the host's .env. HOST_PORT there
# moves the server off the 8081 that compose.yaml defaults to.
set -euo pipefail

WHAT="${1:-all}"
HOST="${2:-${GOSAILING_HOST:-martin@voyager}}"
DIR=gosailing-docker
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$WHAT" in
  server) SERVICES=(server) ;;
  ai) SERVICES=(ai) ;;
  all) SERVICES=(server ai) ;;
  *) echo "usage: $0 [server|ai|all] [user@host]"; exit 1 ;;
esac

cd "$HERE"
TAG=$(git rev-parse --short HEAD)
git diff --quiet HEAD || TAG="$TAG-dirty"

for service in "${SERVICES[@]}"; do
  echo "==> building and pushing mpihlak/gosailing-$service:$TAG"
  docker buildx build --platform linux/amd64 --target "$service" \
    -t "mpihlak/gosailing-$service:$TAG" -t "mpihlak/gosailing-$service:latest" \
    --push .
done

echo "==> copying compose.yaml to $HOST"
ssh "$HOST" "mkdir -p ~/$DIR/logs"
scp -q deploy/compose.yaml "$HOST:$DIR/compose.yaml"

echo "==> starting ${SERVICES[*]}"
ssh "$HOST" "cd ~/$DIR && docker compose pull -q ${SERVICES[*]} && docker compose up -d ${SERVICES[*]}"

echo "==> checking health"
PORT=$(ssh "$HOST" "cd ~/$DIR && docker compose port server 8080 | cut -d: -f2")
for _ in $(seq 30); do
  if HEALTH=$(ssh "$HOST" "curl -fsS --max-time 2 http://127.0.0.1:$PORT/health" 2>/dev/null); then
    echo "    $HEALTH"
    ssh "$HOST" "cd ~/$DIR && docker compose ps --format '    {{.Service}} {{.Image}} {{.Status}}'"
    echo "deployed"
    exit 0
  fi
  sleep 1
done

echo "it did not answer /health:"
ssh "$HOST" "cd ~/$DIR && docker compose ps && docker compose logs --tail 20" || true
exit 1
