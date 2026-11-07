#!/bin/sh
# Runs every E³ job (independent seeds) 8 at a time, then the paired and clip runs.
# Usage (from the repo root): sh <this dir>/run_torus.sh
T=$(dirname "$0")
OUT=$T/results_torus.jsonl; : > $OUT
i=100
{
for q in Q0 Q1; do
  for j in $(npx tsx $T/torus.ts list); do
    i=$((i+1)); n=600000; [ $q = Q1 ] && n=300000
    echo "job $j $q $n $i"
  done
done
echo "paired pt,crystal-pt Q0 200000 7"
echo "paired BALL2-mis,crystal-BALL2-mis Q1 100000 8"
echo "paired BALL2w-mis,crystal-BALL2w-mis Q0 200000 9"
echo "paired BALL2-nee,crystal-BALL2-nee Q1 100000 10"
for r in 2 4 8 16 32; do echo "job pt Q0 400000 $((500+r)) $r"; done
for r in 2 8; do echo "job U27-mis Q0 300000 $((600+r)) $r"; echo "job U27-mis Q1 200000 $((700+r)) $r"; echo "job pt Q1 200000 $((800+r)) $r"; done
} | xargs -P 8 -L 1 sh -c 'npx tsx '"$T"'/torus.ts "$@" >> '"$OUT"'' _
