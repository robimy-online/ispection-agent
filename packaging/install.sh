#!/usr/bin/env sh
# ispection agent — native installer (no Docker). Linux (systemd) / macOS (launchd).
# Run from the repo root:  sudo sh packaging/install.sh
# Optional up-front vars:  INGEST_URL=... CLAIM_CODE=... INSTALL_DIR=... sudo -E sh packaging/install.sh
set -eu

INSTALL_DIR="${INSTALL_DIR:-/opt/ispection-agent}"
INGEST_URL="${INGEST_URL:-https://ispection.robimy.online/api}"
CLAIM_CODE="${CLAIM_CODE:-}"
SERVICE_USER="${SERVICE_USER:-ispection}"

SRC="$(cd "$(dirname "$0")/.." && pwd)"
OS="$(uname -s)"

log() { printf '\033[1;36m[install]\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m[install] ERROR:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Run with sudo (needed for the system service and $INSTALL_DIR)."

command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node 22+ and re-run."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node $NODE_MAJOR is too old — the agent needs Node 22+ (global fetch/WebSocket)."
NODE_BIN="$(command -v node)"

if [ -z "$CLAIM_CODE" ]; then
  printf 'Enter CLAIM_CODE (from the panel, "Add agent"): '
  read -r CLAIM_CODE
fi
[ -n "$CLAIM_CODE" ] || die "CLAIM_CODE is required."

log "Installing to $INSTALL_DIR (source: $SRC)"
mkdir -p "$INSTALL_DIR"
# Copy source without node_modules/.git/dist (dist is built in place).
tar -cf - --exclude=node_modules --exclude=.git --exclude=dist -C "$SRC" . | tar -xf - -C "$INSTALL_DIR"

log "Installing dependencies + building"
( cd "$INSTALL_DIR" && npm install --no-audit --no-fund && npm run build )

if [ "$OS" = "Linux" ]; then
  command -v systemctl >/dev/null 2>&1 || die "systemd not found. Run the agent manually: node $INSTALL_DIR/dist/index.js"
  id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  mkdir -p /var/lib/ispection-agent
  chown -R "$SERVICE_USER":"$SERVICE_USER" /var/lib/ispection-agent "$INSTALL_DIR"

  umask 077
  cat > /etc/ispection-agent.env <<EOF
INGEST_URL=$INGEST_URL
CLAIM_CODE=$CLAIM_CODE
AGENT_DATA_DIR=/var/lib/ispection-agent
EOF
  chown "$SERVICE_USER":"$SERVICE_USER" /etc/ispection-agent.env

  sed -e "s#/opt/ispection-agent#$INSTALL_DIR#g" -e "s#^User=ispection#User=$SERVICE_USER#" \
    "$INSTALL_DIR/packaging/ispection-agent.service" > /etc/systemd/system/ispection-agent.service
  systemctl daemon-reload
  systemctl enable --now ispection-agent
  log "Done. Status: systemctl status ispection-agent | Logs: journalctl -u ispection-agent -f"

elif [ "$OS" = "Darwin" ]; then
  PLIST=/Library/LaunchDaemons/com.ispection.agent.plist
  mkdir -p "$INSTALL_DIR/data"
  sed -e "s#__NODE__#$NODE_BIN#g" -e "s#__INSTALL_DIR__#$INSTALL_DIR#g" \
      -e "s#__INGEST_URL__#$INGEST_URL#g" -e "s#__CLAIM_CODE__#$CLAIM_CODE#g" \
      "$INSTALL_DIR/packaging/com.ispection.agent.plist" > "$PLIST"
  chmod 600 "$PLIST"
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  log "Done. Logs: tail -f /tmp/ispection-agent.log /tmp/ispection-agent.err.log"

else
  die "Unsupported OS: $OS. Use the Docker image (see README)."
fi
