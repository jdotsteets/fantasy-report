#!/usr/bin/env bash
set -euo pipefail

BASE=${BASE:-http://localhost:3000}
LIMIT=${LIMIT:-500}
DAYS=${DAYS:-365}
MODE=${MODE:-topics}
ONLY_MISSING=${ONLY_MISSING:-1}
ONLY_UNDATED=${ONLY_UNDATED:-1}
MISSING=${MISSING:-all}
DRYRUN=${DRYRUN:-0}

qs="days=$DAYS&limit=$LIMIT&mode=$MODE&onlyMissing=$ONLY_MISSING&onlyUndated=$ONLY_UNDATED&missing=$MISSING&dryRun=$DRYRUN"

pass=1
while : ; do
  echo "── pass #$pass"
  echo "POST $BASE/api/backfill-classify?$qs"
  resp=$(curl -sS -X POST "$BASE/api/backfill-classify?$qs" || true)

  # ensure JSON
  if ! echo "$resp" | jq . >/dev/null 2>&1; then
    echo "$resp"
    echo "Could not parse response; stopping."
    exit 1
  fi

  echo "$resp"

  remaining=$(echo "$resp" | jq -r '.remainingMissing // 0')
  changedTopics=$(echo "$resp" | jq -r '.changedTopics // .updatedTopics // 0')
  changedStatic=$(echo "$resp" | jq -r '.changedStatic // .updatedStatic // 0')
  errors=$(echo "$resp" | jq -r '.errors // 0')

  echo "pass #$pass: remaining=$remaining changedTopics=$changedTopics changedStatic=$changedStatic errors=$errors"

  if [ "$DRYRUN" != "0" ]; then
    echo "Dry run; stopping."
    exit 0
  fi

  # stop if done or stuck
  if [ "$remaining" -le 0 ]; then
    echo "All done."
    exit 0
  fi
  if [ "$changedTopics" -eq 0 ] && [ "$changedStatic" -eq 0 ]; then
    echo "No changes in this pass; stopping."
    exit 0
  fi

  pass=$((pass+1))
done
