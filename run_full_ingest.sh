#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
LIMIT="${LIMIT:-100}"
DEBUG="${DEBUG:-true}"

echo "Base: $BASE"
echo "Limit per source: $LIMIT"
echo "Debug: $DEBUG"
echo

echo "→ Fetching allowed sources ..."
RAW="$(curl -sS "$BASE/api/admin/sources/allowed")"

# Accept either {sources:[...]} or a raw array; bail out otherwise
IDS="$(
  echo "$RAW" | jq -r '
    if type=="object" and has("sources") then .sources
    elif type=="array" then .
    else [] end
    | map(select(.allowed == true or .allowed == null))   # assume allowed by default
    | map(.id)
    | .[]
  '
)"

if [[ -z "${IDS:-}" ]]; then
  echo "No allowed sources found or unexpected response:"
  echo "$RAW"
  exit 1
fi

for id in $IDS; do
  echo
  echo "→ Start ingest for source $id ..."
  RESP="$(curl -sS -X POST "$BASE/api/admin/jobs/ingest" \
    -H "content-type: application/json" \
    -d "{\"sourceId\": $id, \"limit\": $LIMIT, \"debug\": $DEBUG}")"

  JOB="$(echo "$RESP" | jq -r '.job_id // empty')"
  if [[ -z "$JOB" ]]; then
    echo "Failed to start job for source $id; response was:"
    echo "$RESP"
    continue
  fi

  echo "   job: $JOB"

  # simple status poll
  while :; do
    STATE="$(curl -sS "$BASE/api/admin/jobs/$JOB" | jq -r '.job.status')"
    PROG="$(curl -sS "$BASE/api/admin/jobs/$JOB" | jq -r '.job.progress_current')"
    echo "   status=$STATE progress=$PROG"
    [[ "$STATE" == "success" || "$STATE" == "error" ]] && break
    sleep 1
  done
done

echo
echo "✓ Done."
