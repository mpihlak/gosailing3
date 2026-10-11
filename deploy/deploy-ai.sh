#!/usr/bin/env bash
#
# Builds the robot sailors and installs them on the host as a systemd user service,
# beside the server and separate from it.
#
#   ./deploy/deploy-ai.sh [user@host]
set -euo pipefail

HOST="${1:-${GOSAILING_HOST:-martin@voyager}}"
DIR=gosailing-ai
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$HERE"

echo "==> building"
npm run build:ai
BUNDLE=dist-ai/main.js
[ -f "$BUNDLE" ] || { echo "no $BUNDLE"; exit 1; }
echo "    $BUNDLE, $(wc -c < "$BUNDLE" | tr -d ' ') bytes"

echo "==> locating node on $HOST"
NODE=$(ssh "$HOST" 'command -v node || find "$HOME/.nvm/versions/node" -maxdepth 3 -type f -name node -perm -u+x 2>/dev/null | sort -V | tail -1')
[ -n "$NODE" ] || { echo "no node found on $HOST"; exit 1; }
echo "    $NODE ($(ssh "$HOST" "$NODE -v"))"

echo "==> copying"
ssh "$HOST" "mkdir -p ~/$DIR ~/.config/systemd/user"
scp -q "$BUNDLE" "$HOST:$DIR/main.js.new"
sed "s|@NODE@|$NODE|" deploy/gosailing-ai.service | ssh "$HOST" "cat > ~/.config/systemd/user/gosailing-ai.service"

echo "==> restarting"
ssh "$HOST" "
  mv ~/$DIR/main.js.new ~/$DIR/main.js
  systemctl --user daemon-reload
  systemctl --user enable gosailing-ai >/dev/null
  systemctl --user restart gosailing-ai
"

echo "==> checking they joined"
sleep 5
ssh "$HOST" "systemctl --user is-active gosailing-ai && journalctl --user -u gosailing-ai -o cat -n 10 --no-pager"
