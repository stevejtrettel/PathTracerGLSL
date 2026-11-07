#!/bin/sh
cd /Users/stevetrettel/Code/PathTracerGLSL
: > /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/review-0/rerun2.out
for s in 1 2 3 4 5; do
  NB=1 npx tsx /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/twin/sw_twin.ts job S13-mis Q1 2000000 $((9400+s)) | sed "s/^/D1big /" >> /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/review-0/rerun2.out &
  NB=1 npx tsx /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/twin/sw_twin.ts job pt Q1 2000000 $((9500+s)) | sed "s/^/D1big /" >> /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/review-0/rerun2.out &
done
npx tsx /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/review-0/sw_cross.ts 20000 11 0.0 | sed "s/^/CROSS-uniform /" >> /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/review-0/rerun2.out &
npx tsx /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/review-0/sw_cross.ts 20000 12 1.0 | sed "s/^/CROSS-nearedge /" >> /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/review-0/rerun2.out &
wait
