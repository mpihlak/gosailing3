#!/usr/bin/env bash
#
# Builds the server and installs it on the host as a systemd user service.
#
#   ./deploy/deploy.sh [user@host]
#
# The whole server is one bundled file, so a deploy is: copy main.js, restart the
# unit, check /health. There is nothing to install on the host and no node_modules.
set -euo pipefail

HOST="${1:-${GOSAILING_HOST:-martin@voyager}}"
DIR=gosailing
PORT=8080
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$HERE"

echo "==> building"
npm run build:server
BUNDLE=dist-server/main.js
[ -f "$BUNDLE" ] || { echo "no $BUNDLE"; exit 1; }
echo "    $BUNDLE, $(wc -c < "$BUNDLE" | tr -d ' ') bytes"

# nvm leaves node off the PATH of a non-interactive shell, so the unit has to name it
# outright. Resolving it per deploy rather than pinning a version keeps the unit working
# across a node upgrade on the host.
echo "==> locating node on $HOST"
NODE=$(ssh "$HOST" 'command -v node || find "$HOME/.nvm/versions/node" -maxdepth 3 -type f -name node -perm -u+x 2>/dev/null | sort -V | tail -1')
[ -n "$NODE" ] || { echo "no node found on $HOST"; exit 1; }
echo "    $NODE ($(ssh "$HOST" "$NODE -v"))"

echo "==> copying"
ssh "$HOST" "mkdir -p ~/$DIR ~/.config/systemd/user"
scp -q "$BUNDLE" "$HOST:$DIR/main.js.new"
sed "s|@NODE@|$NODE|" deploy/gosailing.service | ssh "$HOST" "cat > ~/.config/systemd/user/gosailing.service"

echo "==> restarting"
ssh "$HOST" "
  mv ~/$DIR/main.js.new ~/$DIR/main.js
  systemctl --user daemon-reload
  systemctl --user enable gosailing >/dev/null
  systemctl --user restart gosailing
"

echo "==> checking health"
for _ in $(seq 20); do
  if HEALTH=$(ssh "$HOST" "curl -fsS --max-time 2 http://127.0.0.1:$PORT/health" 2>/dev/null); then
    echo "    $HEALTH"
    echo "deployed"
    exit 0
  fi
  sleep 0.5
done

echo "it did not answer /health:"
ssh "$HOST" "systemctl --user status gosailing --no-pager --lines=20" || true
exit 1
