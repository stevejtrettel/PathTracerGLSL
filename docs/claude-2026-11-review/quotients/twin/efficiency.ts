// Variance × work relative to pt. Work = cell visits per path: every traced segment visits (1 + its
// face crossings) cells, for camera/BSDF segments and shadow rays alike. A GPU cost proxy, not a timing.
import { readFileSync } from "node:fs";
for (const file of process.argv.slice(2)) {
  const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.name && r.q === "Q1" && (r.rseg === 4 && r.space === "E3" || r.rseg === 8 && r.space === "SW"));
  const work = (r: any) => (r.segs / r.n) * (1 + r.crossPerSeg) + (r.shadowRays / r.n) * (1 + (r.shadowCrossPerRay || 0));
  for (const space of ["E3", "SW"]) {
    const rs = rows.filter((r) => r.space === space && !r.name.startsWith("WRONG") && !r.name.startsWith("crystal")); if (!rs.length) continue;
    const pt = rs.find((r) => r.name === "pt"); if (!pt) continue;
    console.log(`\n${file.split("/").pop()} ${space} Q1 maxBounces ${rs[0].nb ?? 4}\n| estimator | var/var(pt) | cell visits/path | (var·work)/(var·work)(pt) |\n|---|---|---|---|`);
    for (const r of rs) console.log(`| ${r.name} | ${(r.var / pt.var).toFixed(3)} | ${work(r).toFixed(2)} | ${((r.var * work(r)) / (pt.var * work(pt))).toFixed(3)} |`);
  }
}
