#!/bin/sh
# Forwards a Claude Code hook event (JSON on stdin) to the local agent-office server.
# Never prints anything and always exits 0 so it can never disturb Claude Code.
command -v curl >/dev/null 2>&1 || exit 0

PORT="$AGENT_OFFICE_PORT"
if [ -z "$PORT" ]; then
  CFG="$HOME/.config/agent-office/server.json"
  if [ -r "$CFG" ]; then
    if command -v jq >/dev/null 2>&1; then
      PORT=$(jq -r '.port // empty' "$CFG" 2>/dev/null)
    else
      PORT=$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$CFG" 2>/dev/null | head -n 1)
    fi
  fi
fi
case "$PORT" in
  ''|*[!0-9]*) PORT=4242 ;;
esac

curl -s -o /dev/null --max-time 1 -H 'content-type: application/json' --data-binary @- \
  "http://127.0.0.1:$PORT/api/events" 2>/dev/null
exit 0
