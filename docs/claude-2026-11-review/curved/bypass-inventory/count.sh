#!/bin/sh
# Count inventory rows of notes.md by category and subset flag. Row = "- <ID> | site | quote | CAT | sub | note".
N=/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/curved/bypass-inventory/notes.md
grep -E '^- [A-Z][0-9]+ \|' "$N" | sed 's/ |$/ | /' | awk -F' \\| ' '{c=$4; s=$5; gsub(/[ |]/,"",c); gsub(/[ |]/,"",s); n[c]++; ns[c" "s]++; t++; st[s]++}
END { printf "total site rows %d (S %d, X %d, U %d)\n", t, st["S"], st["X"], st["U"];
      for (k in n) printf "%-12s %3d   (S %d, X %d, U %d)\n", k, n[k], ns[k" S"], ns[k" X"], ns[k" U"] }'
