#!/usr/bin/env bash
# Runs the QA Playwright suite for ONE project. Usage: run-project.sh <label> <sha> <project> [workers]
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL=$1 SHA=$2 PROJECT=$3 WORKERS=${4:-2}
cd "$ROOT/frontend"
QA_SHA=$SHA QA_WORKERS=$WORKERS PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers QA_JSON="../qa/results/playwright-$LABEL-$PROJECT.json" QA_OUT="../qa/traces/test-output/$LABEL-$PROJECT" \
  node node_modules/@playwright/test/cli.js test -c qa.config.ts --project="$PROJECT" > "../qa/results/playwright-$LABEL-$PROJECT.log" 2>&1
echo "EXIT $? $PROJECT"; tail -5 "../qa/results/playwright-$LABEL-$PROJECT.log"
