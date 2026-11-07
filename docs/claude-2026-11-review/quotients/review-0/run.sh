#!/bin/sh
cd /Users/stevetrettel/Code/PathTracerGLSL
T=/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/twin
R=/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/review-0
run() { tag=$1; shift; if [ "$tag" = SWD1 ]; then NB=1 npx tsx "$@"; else npx tsx "$@"; fi | sed "s/^/$tag /" >> $R/rerun.out 2>&1; }
: > $R/rerun.out
run E3 $T/torus.ts check &
run E3 $T/torus.ts paired pt,crystal-pt Q0 30000 4242 &
run E3 $T/torus.ts job pt Q1 300000 9101 &
run E3 $T/torus.ts job U27-mis Q1 300000 9102 &
run E3 $T/torus.ts job U27-nee Q1 300000 9103 &
run E3 $T/torus.ts job WRONG-W1 Q1 200000 9104 &
run E3 $T/torus.ts job WRONG-W2 Q1 200000 9105 &
run SW $T/sw_twin.ts firsthit 20000 3 9201 &
wait
run SWD1 $T/sw_twin.ts job pt Q1 1200000 9301 &
run SWD1 $T/sw_twin.ts job S1-mis Q1 1200000 9302 &
run SWD1 $T/sw_twin.ts job S13-mis Q1 1200000 9303 &
run SWD1 $T/sw_twin.ts job WRONG-W2 Q1 1200000 9304 &
run SWD1 $T/sw_twin.ts job S13-nee Q1 1200000 9305 &
run SWD1 $T/sw_twin.ts job S1-nee Q1 1200000 9306 &
run SWD1 $T/sw_twin.ts job pt Q1 1200000 9307 &
wait
