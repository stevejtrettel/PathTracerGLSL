// Tables from results_*.jsonl: per quantity, each estimator's mean ± se, z against pt and against the
// pooled mean of the correct estimators, per-sample variance, variance relative to pt, and walk stats.
import { readFileSync } from "node:fs";
const file = process.argv[2];
const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const f = (x: number, d = 4) => (x === undefined || Number.isNaN(x) ? "" : x.toFixed(d));
for (const q of ["Q0", "Q1"]) {
  const main = rows.filter((r) => r.name && r.q === q && r.rseg === (r.space === "E3" ? 4 : 8));
  if (!main.length) continue;
  const pt = main.find((r) => r.name === "pt");
  const ok = main.filter((r) => !r.name.startsWith("WRONG"));
  const wsum = ok.reduce((a, r) => a + 1 / r.se ** 2, 0), pooled = ok.reduce((a, r) => a + r.mean / r.se ** 2, 0) / wsum;
  console.log(`\n### ${rows[0].space} ${q}  (R_seg = ${main[0].rseg}; pooled mean of correct estimators = ${f(pooled, 5)} ± ${f(1 / Math.sqrt(wsum), 5)})\n`);
  console.log("| estimator | n | mean ± se | z vs pt | z vs pooled | var/sample | var / var(pt) | shadow rays/path | NEE visible | mean |S(x)| | crossings/seg (max) | shadow crossings (max) |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of main) {
    const zpt = r === pt ? "" : f((r.mean - pt.mean) / Math.hypot(r.se, pt.se), 2);
    const zpo = f((r.mean - pooled) / r.se, 2);
    console.log(`| ${r.name} | ${r.n} | ${f(r.mean, 5)} ± ${f(r.se, 5)} | ${zpt} | ${zpo} | ${f(r.var, 3)} | ${f(r.var / pt.var, 3)} | ${f(r.shadowRays / r.n, 2)} | ${r.shadowRays ? f(r.neeVisibleFrac, 3) : ""} | ${r.meanSetSize ? f(r.meanSetSize, 1) : ""} | ${r.crossPerSeg !== undefined ? f(r.crossPerSeg, 2) + " (" + r.maxCross + ")" : ""} | ${r.shadowRays ? f(r.shadowCrossPerRay, 2) + " (" + r.shadowMaxCross + ")" : ""} |`);
  }
}
const sweep = rows.filter((r) => r.name && (r.name === "pt" || r.name === "U27-mis" || r.name === "S13-mis"));
console.log("\n### far-clip sweep\n\n| estimator | q | R_seg | mean ± se | clipped fraction | crossings/seg (max) |\n|---|---|---|---|---|---|");
for (const r of sweep.sort((a, b) => (a.name + a.q).localeCompare(b.name + b.q) || a.rseg - b.rseg)) console.log(`| ${r.name} | ${r.q} | ${r.rseg} | ${f(r.mean, 5)} ± ${f(r.se, 5)} | ${f(r.clippedFrac, 4)} | ${f(r.crossPerSeg, 2)} (${r.maxCross}) |`);
const other = rows.filter((r) => !r.name);
if (other.length) { console.log("\n### paired / first-hit checks\n"); for (const r of other) console.log("- " + JSON.stringify(r)); }
