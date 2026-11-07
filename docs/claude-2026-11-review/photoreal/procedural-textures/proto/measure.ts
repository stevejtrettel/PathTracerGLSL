import { noise, fbm, turb } from './noise.ts';
// 1. lattice zeros
let maxLattice = 0;
for (let i = -5; i < 5; i++) for (let j = -5; j < 5; j++) for (let k = -5; k < 5; k++) maxLattice = Math.max(maxLattice, Math.abs(noise(i, j, k)));
console.log('max |noise| at lattice points:', maxLattice);
// 2. range: random search + local hill climb
let rng = 12345; const rnd = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296);
let mx = 0, mn = 0, sum = 0, sum2 = 0; const N = 2_000_000;
for (let n = 0; n < N; n++) { const v = noise(rnd() * 256, rnd() * 256, rnd() * 256); mx = Math.max(mx, v); mn = Math.min(mn, v); sum += v; sum2 += v * v; }
console.log('random', N, 'samples: min', mn.toFixed(4), 'max', mx.toFixed(4), 'mean', (sum / N).toFixed(5), 'rms', Math.sqrt(sum2 / N).toFixed(4));
// hill climb from the best samples over all 256^3 cells is too big; climb inside every cell of a 32^3 block
let best = 0;
for (let i = 0; i < 32; i++) for (let j = 0; j < 32; j++) for (let k = 0; k < 32; k++) {
  for (let s = 0; s < 4; s++) {
    let x = i + rnd(), y = j + rnd(), z = k + rnd(); let v = Math.abs(noise(x, y, z)); let step = 0.1;
    for (let it = 0; it < 200; it++) {
      const cand = [[x + step, y, z], [x - step, y, z], [x, y + step, z], [x, y - step, z], [x, y, z + step], [x, y, z - step]];
      let moved = false;
      for (const c of cand) { const cv = Math.abs(noise(c[0], c[1], c[2])); if (cv > v) { v = cv; [x, y, z] = c; moved = true; } }
      if (!moved) step *= 0.5; if (step < 1e-6) break;
    }
    best = Math.max(best, v);
  }
}
console.log('hill-climbed max |noise| over 32^3 cells:', best.toFixed(5));
// 3. continuity of gradient across a cell face (C2 fade): one-sided FD derivatives at x = integer
const h = 1e-5; let maxJump = 0;
for (let t = 0; t < 1000; t++) { const x = 7, y = rnd() * 20, z = rnd() * 20;
  const dl = (noise(x, y, z) - noise(x - h, y, z)) / h, dr = (noise(x + h, y, z) - noise(x, y, z)) / h; maxJump = Math.max(maxJump, Math.abs(dl - dr)); }
console.log('max one-sided derivative jump across a cell face:', maxJump.toExponential(2));
// 4. fbm / turbulence bounds with pbrt defaults (omega 0.5, 8 octaves): sum of o_i * B
let fm = 0, tm = 0;
for (let n = 0; n < 200000; n++) { const x = rnd() * 64, y = rnd() * 64, z = rnd() * 64; fm = Math.max(fm, Math.abs(fbm(x, y, z, 0.5, 8))); tm = Math.max(tm, turb(x, y, z, 0.5, 8)); }
console.log('sampled max |fbm(0.5,8)|', fm.toFixed(4), ' max turb(0.5,8)', tm.toFixed(4), ' geometric sum 1..8 of 0.5^i:', (2 * (1 - 0.5 ** 8)).toFixed(4));
// 5. a few reference values for the GPU probe
for (const p of [[0.5, 0.5, 0.5], [1.25, -3.7, 10.1], [123.456, 7.89, -0.001], [-0.3, 0.2, 255.9]]) console.log('noise', p, noise(p[0], p[1], p[2]).toFixed(7), 'fbm', fbm(p[0], p[1], p[2], 0.5, 8).toFixed(7));
