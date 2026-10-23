#!/usr/bin/env bash
# Start/stop the isolated QA stack: API :8001 on database expo_leads_qa, UI :5174.
# Usage: qa/scripts/qa-stack.sh start|stop|reseed
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${QA_LOG_DIR:-/tmp/qa-logs}"; mkdir -p "$LOG"
export DATABASE_URL="${QA_DATABASE_URL:-postgres://expo:expo@127.0.0.1:5432/expo_leads_qa}"
stop() {
  for f in "$LOG/api.pid" "$LOG/ui.pid"; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done
  sleep 1
}
case "${1:-start}" in
  stop) stop ;;
  reseed)
    cd "$ROOT/backend" && ../.venv/bin/python manage.py migrate -v0 && ../.venv/bin/python manage.py seed_demo --reset && ../.venv/bin/python manage.py seed_qa ;;
  start)
    stop
    cd "$ROOT/backend"
    LOGIN_THROTTLE="${LOGIN_THROTTLE:-500/min}" nohup ../.venv/bin/python manage.py runserver 127.0.0.1:8001 --noreload >"$LOG/api.log" 2>&1 &
    echo $! >"$LOG/api.pid"
    cd "$ROOT/frontend"
    BACKEND_URL=http://127.0.0.1:8001 nohup node node_modules/vite/bin/vite.js --port 5174 --strictPort >"$LOG/ui.log" 2>&1 &
    echo $! >"$LOG/ui.pid"
    for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:5174/api/v1/branding && { echo "QA stack up"; exit 0; }; sleep 1; done
    echo "QA stack failed to start"; tail -20 "$LOG/api.log" "$LOG/ui.log"; exit 1 ;;
esac
