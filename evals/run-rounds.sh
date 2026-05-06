#!/bin/bash
# Run N rounds of all 7 stacks with breakout, randomizing launch order each round.
# Usage: ./evals/run-rounds.sh <num-rounds> <campaign-tag>
# Each stack within a round runs in parallel (1 concurrent eval per stack process);
# rounds run sequentially.

set -u

ROUNDS="${1:-3}"
CAMPAIGN="${2:-breakout-opus-$(date +%H%M%S)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT" || exit 1

stacks=(
  'web canvas'
  'web pixi'
  'web experimental-web-canvas'
  'web experimental-web-pixi'
  'web cli-script'
  'cli4 single-script'
  'cli4 separate-actors'
)

# Fisher-Yates shuffle in bash
shuffle() {
  local i tmp size=${#stacks[@]}
  for ((i=size-1; i>0; i--)); do
    local j=$((RANDOM % (i+1)))
    tmp="${stacks[i]}"; stacks[i]="${stacks[j]}"; stacks[j]="$tmp"
  done
}

mkdir -p eval-runs/rounds-logs

for ((r=1; r<=ROUNDS; r++)); do
  shuffle
  round_tag="${CAMPAIGN}-r${r}"
  echo "[rounds] === round $r/$ROUNDS — order: ${stacks[*]} ==="
  pids=()
  for entry in "${stacks[@]}"; do
    family="${entry%% *}"
    stack="${entry#* }"
    log="eval-runs/rounds-logs/${round_tag}-${stack}.log"
    if [ "$family" = "web" ]; then
      ( npx tsx evals/run-web-smoke-matrix.ts \
          --stack "$stack" \
          --prompt breakout \
          --spec claude:opus:high \
          --concurrency 1 \
          --timeout-min 5 \
          --run-group "${round_tag}-${stack}" \
          --console-output-limit-kb 4 > "$log" 2>&1 ) &
    else
      # cli4 family: variant arg
      ( npx tsx evals/run-agent-eval.ts \
          --agent claude --model opus --effort high \
          --prompt breakout \
          --variant "$stack" \
          --timeout-min 5 \
          --run-group "${round_tag}-${stack}" \
          --console-output-limit-kb 4 \
          --browser-timeout-ms 45000 \
          --command-timeout-ms 15000 > "$log" 2>&1 ) &
    fi
    pids+=($!)
    # tiny stagger to avoid simultaneous npm-cache contention
    sleep 0.5
  done
  echo "[rounds] round $r launched ${#pids[@]} jobs (pids: ${pids[*]}). waiting..."
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
  echo "[rounds] round $r complete."
done

echo "[rounds] campaign ${CAMPAIGN} done. results under eval-runs/."
