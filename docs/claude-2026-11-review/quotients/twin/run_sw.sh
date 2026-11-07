#!/bin/sh
# Runs every Seifert–Weber job (independent seeds) 8 at a time, plus the first-hit check and the clip sweep.
# Usage (from the repo root): sh <this dir>/run_sw.sh
T=$(dirname "$0")
OUT=$T/results_sw.jsonl; : > $OUT
i=2000
{
echo "firsthit 20000 3 77"
for q in Q0 Q1; do
  for j in $(npx tsx $T/sw_twin.ts list); do
    i=$((i+1)); n=300000
    case $j in BALL3*) n=150000;; esac
    echo "job $j $q $n $i"
  done
done
for r in 4 8 12 16; do echo "job pt Q1 200000 $((3000+r)) $r"; done
echo "job S13-mis Q1 150000 3104 4"
echo "job S13-mis Q1 150000 3112 12"
} | xargs -P 8 -L 1 sh -c 'npx tsx '"$T"'/sw_twin.ts "$@" >> '"$OUT"'' _
