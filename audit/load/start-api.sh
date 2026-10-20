#!/bin/sh
# Starts the built API against the isolated load-test DB on :4321. Usage: start-api.sh <logfile> <pidfile> [extra env...]
cd "$(dirname "$0")/../.." || exit 1
export PATH="$HOME/.local/node-v22.23.3-darwin-arm64/bin:$PATH"
LOG=$1; PID=$2; shift 2
env DATABASE_URL=postgres://meduza:meduza_local@127.0.0.1:5433/meduza_load_test API_PORT=4321 APP_MODE=demo AUTO_SEED=1 AI_MODE=sample \
  BACKGROUND_WORKERS=off MEDUZA_TEST=1 "$@" nohup node apps/api/dist/main.js > "$LOG" 2>&1 &
echo $! > "$PID"
for i in $(seq 1 60); do grep -q "Med.uz.ai API" "$LOG" && exit 0; sleep 0.5; done
echo "API did not start"; tail -20 "$LOG"; exit 1
