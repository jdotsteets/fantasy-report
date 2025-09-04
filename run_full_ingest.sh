#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
LIMIT="${LIMIT:-100}"
DEBUG="${DEBUG:-true}"
SLEEP_SECS="${SLEEP_SECS:-2}"

if ! command -v jq >/dev/null 2>&1; then
  echo "This script needs 'jq' (brew install jq)"; exit 1
fi

echo "Base: $BASE"
echo "Limit per source: $LIMIT"
echo "Debug: $DEBUG"
echo

echo "→ Fetching allowed sources ..."
echo "→ Fetching allowed sources ..."
SOURCES_JSON="$(curl -sS "$BASE/api/admin/sources")"

# Works whether the API returns { "sources": [...] } or just [ ... ]
SOURCE_IDS=($(echo "$SOURCES_JSON" | jq -r '
  (if type=="object" and has("sources") then .sources else . end)
  | map(select(.allowed != false))
  | .[].id
'))


if [ "${#SOURCE_IDS[@]}" -eq 0 ]; then
  echo "No allowed sources found. (Check /api/admin/sources output.)"
  exit 1
fi
echo "Found ${#SOURCE_IDS[@]} allowed sources: ${SOURCE_IDS[*]}"
echo

JOB_IDS=()
JOB_SRC=()
DEBUG_BOOL=$( [ "$DEBUG" = "true" ] && echo true || echo false )

for sid in "${SOURCE_IDS[@]}"; do
  echo "↗ Starting ingest for source $sid ..."
  RESP="$(curl -sS -X POST "$BASE/api/admin/jobs/ingest" \
    -H 'content-type: application/json' \
    -d "{\"sourceId\":$sid,\"limit\":$LIMIT,\"debug\":$DEBUG_BOOL}")"
  JOB_ID="$(echo "$RESP" | jq -r '.job_id // empty')"
  if [ -n "$JOB_ID" ]; then
    echo "  started job_id=$JOB_ID"
    JOB_IDS+=("$JOB_ID"); JOB_SRC+=("$sid")
  else
    echo "  ✗ failed to start job for source $sid → $RESP"
  fi
done

if [ "${#JOB_IDS[@]}" -eq 0 ]; then
  echo "No jobs started. Aborting."; exit 1
fi

echo
echo "Polling ${#JOB_IDS[@]} jobs every ${SLEEP_SECS}s …"
echo

DONE=()
for ((i=0; i<${#JOB_IDS[@]}; i++)); do DONE[i]=0; done
remaining=${#JOB_IDS[@]}

while [ "$remaining" -gt 0 ]; do
  sleep "$SLEEP_SECS"
  for ((i=0; i<${#JOB_IDS[@]}; i++)); do
    if [ "${DONE[i]}" -eq 1 ]; then continue; fi
    jid="${JOB_IDS[i]}"; sid="${JOB_SRC[i]}"

    EV="$(curl -sS "$BASE/api/admin/jobs/$jid/events")" || EV='{}'
    SUMMARY_COUNT=$(echo "$EV" | jq '[.events[]? | select(.message=="Ingest summary")] | length')
    if [ "${SUMMARY_COUNT:-0}" -gt 0 ]; then
      META=$(echo "$EV" | jq -r '[.events[]? | select(.message=="Ingest summary")] | last | .meta')
      ERR_COUNT=$(echo "$EV" | jq '[.events[]? | select(.level=="error")] | length')
      echo "✓ source $sid finished (job $jid)"
      echo "  summary: $(echo "$META" | jq -c '.')  errors: $ERR_COUNT"
      DONE[i]=1; remaining=$((remaining-1))
    else
      FIRST_ERR=$(echo "$EV" | jq -r '[.events[]? | select(.level=="error")][0]?.message // empty')
      if [ -n "$FIRST_ERR" ]; then
        echo "  job $jid (source $sid) error: $FIRST_ERR"
      fi
    fi
  done
done

echo
echo "All jobs completed 🎉"
