// Seifert–Weber dodecahedral space: exact geometry checks in float64, teleport drift in float32.
// Run: node --max-old-space-size=8192 sw.ts [geom|tile|teleport|count|diam|all]
// Conventions: points/vectors are [x, y, z, w], w timelike. Minkowski form <a,b> = a·b(xyz) − a_w b_w.
// Hyperboloid H³ = {<p,p> = −1, w > 0}. Matrices are row-major Float64Array(16), (Mx)_i = Σ_j M[4i+j] x_j.
// D is the regular dodecahedron centered at o = (0,0,0,1) with all dihedral angles 2π/5.
// Face i has OUTWARD unit normal N_i (<N_i,N_i> = 1); a point p is inside D iff <N_i,p> ≤ 0 for all i.

type V4 = number[];
type M4 = Float64Array;
type Rnd = (x: number) => number;
const id: Rnd = (x) => x;
const f32: Rnd = Math.fround;

const SQ5 = Math.sqrt(5);
const PHI = (1 + SQ5) / 2;

// ---------- seeded RNG (mulberry32) ----------
let seed = 12345;
function rand(): number {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gauss(): number {
  const u = Math.max(rand(), 1e-300), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function randUnit3(): number[] {
  const a = [gauss(), gauss(), gauss()];
  const n = Math.hypot(a[0], a[1], a[2]);
  return a.map((x) => x / n);
}

// ---------- linear algebra ----------
const mink = (a: V4, b: V4, r: Rnd = id) =>
  r(r(r(r(a[0] * b[0]) + r(a[1] * b[1])) + r(a[2] * b[2])) - r(a[3] * b[3]));
function apply(M: M4, x: V4, r: Rnd = id): V4 {
  const y = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    let s = 0;
    for (let j = 0; j < 4; j++) s = r(s + r(M[4 * i + j] * x[j]));
    y[i] = s;
  }
  return y;
}
function mul(A: M4, B: M4, r: Rnd = id): M4 {
  const C = new Float64Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s = r(s + r(A[4 * i + k] * B[4 * k + j]));
      C[4 * i + j] = s;
    }
  return C;
}
function eye(): M4 { const I = new Float64Array(16); I[0] = I[5] = I[10] = I[15] = 1; return I; }
// Inverse of an SO(3,1) matrix: J Mᵀ J.
function minv(M: M4): M4 {
  const s = [1, 1, 1, -1];
  const R = new Float64Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) R[4 * i + j] = s[i] * s[j] * M[4 * j + i];
  return R;
}
function maxAbsDiff(A: M4, B: M4): number { let m = 0; for (let i = 0; i < 16; i++) m = Math.max(m, Math.abs(A[i] - B[i])); return m; }
function maxAbs(A: M4): number { let m = 0; for (let i = 0; i < 16; i++) m = Math.max(m, Math.abs(A[i])); return m; }
const round32 = (M: M4): M4 => Float64Array.from(M, (x) => Math.fround(x));
// Defect of being in SO(3,1): max |Mᵀ J M − J|.
function isomDefect(M: M4): number {
  const J = [1, 1, 1, -1];
  let m = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0; for (let k = 0; k < 4; k++) s += M[4 * k + i] * J[k] * M[4 * k + j];
    m = Math.max(m, Math.abs(s - (i === j ? J[i] : 0)));
  }
  return m;
}
function det(M: M4): number {
  const a = Array.from(M);
  const m = (r: number, c: number) => a[4 * r + c];
  let d = 0;
  for (let c = 0; c < 4; c++) {
    const sub: number[] = [];
    for (let r = 1; r < 4; r++) for (let cc = 0; cc < 4; cc++) if (cc !== c) sub.push(m(r, cc));
    const d3 = sub[0] * (sub[4] * sub[8] - sub[5] * sub[7]) - sub[1] * (sub[3] * sub[8] - sub[5] * sub[6]) + sub[2] * (sub[3] * sub[7] - sub[4] * sub[6]);
    d += (c % 2 ? -1 : 1) * m(0, c) * d3;
  }
  return d;
}
const hdist = (a: V4, b: V4) => Math.acosh(Math.max(1, -mink(a, b)));
const O: V4 = [0, 0, 0, 1];

// Rodrigues rotation about unit axis u by angle th (right-handed, same as three.js makeRotationAxis).
function rot(u: number[], th: number): M4 {
  const c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  const [x, y, z] = u;
  return Float64Array.from([
    c + x * x * C, x * y * C - z * s, x * z * C + y * s, 0,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s, 0,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C, 0,
    0, 0, 0, 1,
  ]);
}
// Hyperbolic translation by distance t along unit direction u (at o): o ↦ (sinh t u, cosh t).
function trans(u: number[], t: number): M4 {
  const ch = Math.cosh(t) - 1, sh = Math.sinh(t);
  const M = eye();
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) M[4 * i + j] += ch * u[i] * u[j];
    M[4 * i + 3] = sh * u[i];
    M[12 + i] = sh * u[i];
  }
  M[15] = Math.cosh(t);
  return M;
}

// ---------- the dodecahedron ----------
// Closed forms (derived in notes.md, checked here):
//   cosh² r_in  = (5+2√5)/4,   cosh² r_mid = (25+11√5)/10,   cosh R_c = (7+3√5)/4 = φ⁴/2.
const rIn = Math.acosh(Math.sqrt((5 + 2 * SQ5) / 4));
const rMid = Math.acosh(Math.sqrt((25 + 11 * SQ5) / 10));
const rCirc = Math.acosh((7 + 3 * SQ5) / 4);
const THETA = (3 * Math.PI) / 5; // face-pairing twist, 3/10 turn

// Face directions: thurston-rebuild order (seifert-weber/set.js:30-37); face 2k = +dir_k, 2k+1 = −dir_k.
const dirs0 = [[0, 1, PHI], [0, 1, -PHI], [1, PHI, 0], [1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1]];
const nhat: number[][] = [];
for (const d of dirs0) {
  const n = Math.hypot(d[0], d[1], d[2]);
  const u = d.map((x) => x / n);
  nhat.push(u, u.map((x) => -x));
}
const NF = 12;
const opp = (i: number) => i ^ 1;
// Outward unit Minkowski normal of face i: (n̂ cosh r_in, sinh r_in). <N,p> = sinh(signed distance of p beyond the face).
const N: V4[] = nhat.map((u) => [u[0] * Math.cosh(rIn), u[1] * Math.cosh(rIn), u[2] * Math.cosh(rIn), Math.sinh(rIn)]);
// Pairing applied when a ray exits through face i: g_i maps face i onto face opp(i).
// g_{2k} = T(−2 r_in u_k)·R(u_k, θ) exactly as set.js:79-81; g_{2k+1} = g_{2k}^{-1}.
const G: M4[] = [];
for (let k = 0; k < 6; k++) {
  const u = nhat[2 * k];
  const g = mul(trans(u.map((x) => -x), 2 * rIn), rot(u, THETA));
  G.push(g, minv(g));
}
const inD = (p: V4, tol = 0) => N.every((n) => mink(n, p) <= tol);
const outside = (p: V4) => Math.max(...N.map((n) => mink(n, p)));

// Euclidean-dodecahedron vertices, rescaled to Klein radius tanh R_c, lifted to the hyperboloid.
const V: V4[] = [];
{
  const raw: number[][] = [];
  for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) raw.push([a, b, c]);
  for (const a of [1, -1]) for (const b of [1, -1]) {
    raw.push([a / PHI, 0, b * PHI], [0, a * PHI, b / PHI], [a * PHI, b / PHI, 0]); // dual to face normals (0,±1,±φ),(±1,±φ,0),(±φ,0,±1)
  }
  const k = Math.tanh(rCirc);
  for (const v of raw) {
    const n = Math.hypot(v[0], v[1], v[2]);
    const kv = v.map((x) => (x / n) * k);
    const s = 1 / Math.sqrt(1 - k * k);
    V.push([kv[0] * s, kv[1] * s, kv[2] * s, s]);
  }
}
const facesOfVertex = (v: V4) => N.map((n, i) => [i, mink(n, v)] as const).filter(([, x]) => Math.abs(x) < 1e-9).map(([i]) => i);
const vertexIndex = (p: V4, tol = 1e-8) => V.findIndex((v) => Math.abs(mink(v, p) + 1) < tol);

// ---------- number field helpers ----------
// Is x = (a + b√5)/c with small integers? Returns the representation or null.
function inQ5(x: number, cMax = 64, bMax = 400): string | null {
  for (let c = 1; c <= cMax; c++)
    for (let b = -bMax; b <= bMax; b++) {
      const a = Math.round(c * x - b * SQ5);
      if (Math.abs(c * x - a - b * SQ5) < 1e-9 * Math.max(1, Math.abs(c * x))) return `(${a}${b >= 0 ? "+" : ""}${b}√5)/${c}`;
    }
  return null;
}

function section(name: string) { console.log(`\n==================== ${name} ====================`); }

// ======================================================================
function geom() {
  section("radii (closed forms vs Klein-model construction)");
  // Independent check: dihedral angle from the normals must be 2π/5 for adjacent faces.
  console.log({ rIn, rMid, rCirc, thurstonHalfWidth: 0.996384497847316, diff: rIn - 0.996384497847316 });
  // thurston's comment formula: sinh(h) = sqrt(1 − sin²α − sin²β)/sin β with α = 2π/5, β = atan(1/φ)
  {
    const a = (2 * Math.PI) / 5, b = Math.atan(1 / PHI);
    const val = Math.sqrt(1 - Math.sin(a) ** 2 - Math.sin(b) ** 2) / Math.sin(b);
    console.log("thurston comment formula, asinh(...) =", isNaN(val) ? "NaN (radicand < 0)" : Math.asinh(val), "radicand", 1 - Math.sin(a) ** 2 - Math.sin(b) ** 2);
    const a2 = Math.PI / 5; const val2 = Math.sqrt(1 - Math.sin(a2) ** 2 - Math.sin(b) ** 2) / Math.sin(b);
    console.log("same formula with α = π/5 (half the dihedral angle): asinh =", Math.asinh(val2), " vs r_in", rIn);
  }
  // Midradius / circumradius via Klein: tanh r_mid = tanh r_in / cos β, tanh R_c = tanh r_in / cos γ.
  const cosBeta = 1 / Math.sqrt(1 + 1 / PHI ** 2);
  const cosGamma = Math.sqrt((5 + 2 * SQ5) / 15);
  console.log("r_mid via Klein", Math.atanh(Math.tanh(rIn) / cosBeta), " R_c via Klein", Math.atanh(Math.tanh(rIn) / cosGamma));
  const halfEdge = Math.acosh(Math.cosh(rCirc) / Math.cosh(rMid));
  console.log({ edgeLength: 2 * halfEdge, coshRc_is_phi4_over_2: Math.cosh(rCirc) - PHI ** 4 / 2, cosh2rIn: Math.cosh(2 * rIn), cosh2rIn_closed: (3 + 2 * SQ5) / 2 });

  section("face normals");
  let maxNorm = 0; const dots = new Map<string, number>();
  for (let i = 0; i < NF; i++) {
    maxNorm = Math.max(maxNorm, Math.abs(mink(N[i], N[i]) - 1));
    for (let j = i + 1; j < NF; j++) {
      const d = mink(N[i], N[j]); const k = d.toFixed(9); dots.set(k, (dots.get(k) ?? 0) + 1);
    }
  }
  console.log("max |<N,N>-1| =", maxNorm, " pairwise <N_i,N_j> values (count):", Object.fromEntries(dots));
  console.log("cos(2π/5) =", Math.cos((2 * Math.PI) / 5), " → adjacent faces need <N_i,N_j> = −cos(2π/5) = ", -Math.cos((2 * Math.PI) / 5));
  console.log("N_0 =", N[0].map((x) => +x.toFixed(12)));

  section("vertices");
  const vf = V.map(facesOfVertex);
  console.log("each vertex on exactly 3 faces:", vf.every((f) => f.length === 3), " all inside D (tol 1e-12):", V.every((v) => inD(v, 1e-12)), " d(o,v) − R_c max:", Math.max(...V.map((v) => Math.abs(hdist(O, v) - rCirc))));
  // trihedral solid angle: 3·(2π/5) − π = π/5 ; 20 of them = 4π (vertex link is a sphere)
  console.log("vertex solid angle 3α−π =", 3 * (2 * Math.PI / 5) - Math.PI, " ×20 =", 20 * (3 * (2 * Math.PI / 5) - Math.PI), " 4π =", 4 * Math.PI);

  section("pairings");
  for (let i = 0; i < NF; i++) {
    const g = G[i];
    const verts = V.map((v, k) => k).filter((k) => vf[k].includes(i));
    const imgs = verts.map((k) => vertexIndex(apply(g, V[k])));
    const allOnOpp = imgs.every((k) => k >= 0 && vf[k].includes(opp(i)));
    // g maps hyperplane i to hyperplane opp(i) with D's side flipped: g N_i = −N_opp(i)
    const gN = apply(g, N[i]);
    const nErr = Math.max(...gN.map((x, c) => Math.abs(x + N[opp(i)][c])));
    // centre of face i maps to centre of face opp(i)
    const fc = [nhat[i][0] * Math.sinh(rIn), nhat[i][1] * Math.sinh(rIn), nhat[i][2] * Math.sinh(rIn), Math.cosh(rIn)];
    const fcImg = apply(g, fc);
    const go = apply(g, O);
    console.log(`face ${i}: SO+(3,1) defect ${isomDefect(g).toExponential(2)} det ${det(g).toFixed(12)} g_ww ${g[15].toFixed(6)} | 5 vertices → face ${opp(i)}: ${allOnOpp} | gN_i = −N_opp err ${nErr.toExponential(2)} | face-centre err ${hdist(fcImg, [-fc[0], -fc[1], -fc[2], fc[3]]).toExponential(2)} | d(o,g o) = ${hdist(O, go).toFixed(9)} (2r_in = ${(2 * rIn).toFixed(9)}), g·o beyond face ${opp(i)}: ${mink(N[opp(i)], go) > 0}`);
    // Twist: angle by which g rotates face i's vertex pattern, seen at the image face.
    // Compare g(v) with the reflection-free translate T(−2r u) v: the rotation angle between them about u.
  }
  // Twist check: g = T(−2r u) R(u,θ); conjugate pattern. Vertex k on face 0 goes to a vertex whose
  // azimuth about u differs from the pure translate by exactly θ mod 2π/5 symmetry. Count the offset in units of 2π/10.
  {
    const u = nhat[0];
    const azim = (p: V4) => {
      // project spatial part onto plane ⊥ u, measure angle against a fixed reference e
      const e0 = [1, 0, 0]; const dotu = e0[0] * u[0] + e0[1] * u[1] + e0[2] * u[2];
      const e = e0.map((x, c) => x - dotu * u[c]); const ne = Math.hypot(...e); const e1 = e.map((x) => x / ne);
      const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
      return Math.atan2(p[0] * e2[0] + p[1] * e2[1] + p[2] * e2[2], p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2]);
    };
    const face0 = V.map((v, k) => k).filter((k) => vf[k].includes(0));
    const opp0 = V.map((v, k) => k).filter((k) => vf[k].includes(1));
    const a0 = face0.map((k) => azim(V[k])).sort((a, b) => a - b);
    const a1 = opp0.map((k) => azim(V[k])).sort((a, b) => a - b);
    console.log("face 0 vertex azimuths about u (deg):", a0.map((x) => (x * 180 / Math.PI).toFixed(3)));
    console.log("opposite face vertex azimuths (deg):", a1.map((x) => (x * 180 / Math.PI).toFixed(3)), "→ opposite pentagons are rotated by 36° relative to each other (antiprism-like), so a 108° twist maps vertices to vertices.");
    const k = face0[0]; const img = apply(G[0], V[k]);
    console.log(`vertex at azimuth ${(azim(V[k]) * 180 / Math.PI).toFixed(3)}° on face 0 maps to azimuth ${(azim(img) * 180 / Math.PI).toFixed(3)}° on face 1 (twist θ = 108°)`);
  }

  section("edge cycles and vertex cycles");
  // edges: pairs of adjacent faces; endpoints = common vertices.
  type Edge = { f: [number, number]; v: [number, number] };
  const edges: Edge[] = [];
  for (let i = 0; i < NF; i++) for (let j = i + 1; j < NF; j++) {
    const common = V.map((_, k) => k).filter((k) => vf[k].includes(i) && vf[k].includes(j));
    if (common.length === 2) edges.push({ f: [i, j], v: [common[0], common[1]] });
  }
  console.log("edges:", edges.length);
  const edgeIdx = (a: number, b: number) => edges.findIndex((e) => (e.v[0] === a && e.v[1] === b) || (e.v[0] === b && e.v[1] === a));
  const cycles: { len: number; angle: number; prodErr: number }[] = [];
  const seen = new Set<number>();
  for (let e0 = 0; e0 < edges.length; e0++) {
    if (seen.has(e0)) continue;
    let e = e0, f = edges[e0].f[0], P = eye(), len = 0;
    do {
      seen.add(e);
      const g = G[f];
      const a = vertexIndex(apply(g, V[edges[e].v[0]])), b = vertexIndex(apply(g, V[edges[e].v[1]]));
      const e2 = edgeIdx(a, b);
      if (e2 < 0) throw new Error("edge image not an edge");
      const fin = opp(f); // the image edge lies on face opp(f); continue through its other face
      const f2 = edges[e2].f[0] === fin ? edges[e2].f[1] : edges[e2].f[0];
      P = mul(g, P); e = e2; f = f2; len++;
      if (len > 20) throw new Error("cycle too long");
    } while (!(e === e0 && f === edges[e0].f[0]));
    cycles.push({ len, angle: len * 72, prodErr: maxAbsDiff(P, eye()) });
  }
  console.log("edge cycles:", cycles);
  // vertex classes via union-find
  const parent = V.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  for (let i = 0; i < NF; i++) for (let k = 0; k < V.length; k++) if (vf[k].includes(i)) {
    const img = vertexIndex(apply(G[i], V[k]));
    parent[find(k)] = find(img);
  }
  console.log("vertex classes:", new Set(V.map((_, k) => find(k))).size, "(Euler χ = V − E + F − C = ", new Set(V.map((_, k) => find(k))).size, "−", cycles.length, "+ 6 − 1 =", new Set(V.map((_, k) => find(k))).size - cycles.length + 6 - 1, ")");

  section("number field of the generator entries (this frame)");
  // Block structure: g = [[A, b],[cᵀ, d]] with A (3×3 rotation-ish), b,c ∝ sinh(2r_in)·u.
  const kappa = Math.sqrt((13 + 7 * SQ5) / 2);
  for (let i = 0; i < 2; i++) {
    const g = G[i];
    const rows: string[] = [];
    for (let r = 0; r < 4; r++) {
      const cells: string[] = [];
      for (let c = 0; c < 4; c++) {
        const x = g[4 * r + c];
        const offDiag = (r === 3) !== (c === 3);
        const rep = offDiag ? inQ5(x / kappa) : inQ5(x);
        cells.push(rep ? (offDiag ? `κ·${rep}` : rep) : `NOT(${x.toFixed(6)})`);
      }
      rows.push(cells.join("  "));
    }
    console.log(`g_${i} entries (κ = √((13+7√5)/2) = ${kappa}):\n  ` + rows.join("\n  "));
    console.log(`  off-diagonal entry g[1][3] = ${g[7]} in Q(√5) itself? ${inQ5(g[7]) ?? "no"}`);
  }
  {
    let allOk = true;
    for (let i = 0; i < NF; i++) for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const x = G[i][4 * r + c]; const offDiag = (r === 3) !== (c === 3);
      if (!(offDiag ? inQ5(x / kappa) : inQ5(x))) allOk = false;
    }
    console.log(`all 12 generators: 3×3 block and ww entry in Q(√5), (xyz,w) entries in κ·Q(√5): ${allOk}`);
  }
  // Traces of the SO(3,1) matrices of random words: in Q(√5)?
  let ok = 0, tot = 0; const samples: string[] = [];
  for (let w = 0; w < 200; w++) {
    let P = eye(); const L = 1 + Math.floor(rand() * 6);
    for (let k = 0; k < L; k++) P = mul(P, G[Math.floor(rand() * NF)]);
    const tr = P[0] + P[5] + P[10] + P[15];
    const rep = inQ5(tr, 16, 2000); tot++; if (rep) ok++;
    if (samples.length < 6) samples.push(`${tr.toFixed(6)}=${rep}`);
  }
  console.log(`traces of 200 random words (length 1–6) in Q(√5): ${ok}/${tot}; e.g.`, samples);
}

// ======================================================================
// Group enumeration by BFS over right multiplication by the 12 generators, dedupe by the orbit point γo.
function enumerate(Rmax: number) {
  const mats: Float64Array[] = [];
  const keyOf = (M: M4) => `${Math.round(M[3] * 1e3)},${Math.round(M[7] * 1e3)},${Math.round(M[11] * 1e3)}`;
  const seenK = new Map<string, number>();
  const I = eye(); mats.push(I); seenK.set(keyOf(I), 0);
  let head = 0;
  const coshMax = Math.cosh(Rmax);
  while (head < mats.length) {
    const M = mats[head++];
    for (let i = 0; i < NF; i++) {
      const P = mul(M, G[i]);
      if (P[15] > coshMax) continue; // (γo)_w = cosh d(o, γo)
      const k = keyOf(P);
      if (seenK.has(k)) {
        // sanity: same orbit point ⇒ same element (Γ torsion-free, o has trivial stabiliser)
        const Q = mats[seenK.get(k)!];
        if (maxAbsDiff(P, Q) > 1e-6 * maxAbs(P)) throw new Error("orbit-point collision with different matrix");
        continue;
      }
      seenK.set(k, mats.length); mats.push(P);
    }
  }
  return mats;
}

function tile() {
  section("12 neighbours of D: disjoint, each across its own face");
  const H = G.map(minv); // cell across face i is H_i D = g_i^{-1} D
  let bad = 0; const nS = 20000; const samplesD: V4[] = [];
  while (samplesD.length < nS) {
    // hyperbolic-uniform in ball of radius R_c (radial density ∝ sinh²ρ), keep those in D
    // propose ρ uniform on [0,R_c], accept with prob sinh²ρ/sinh²R_c
    const r2 = rCirc * rand();
    if (rand() > (Math.sinh(r2) / Math.sinh(rCirc)) ** 2) continue;
    const u = randUnit3();
    const p: V4 = [u[0] * Math.sinh(r2), u[1] * Math.sinh(r2), u[2] * Math.sinh(r2), Math.cosh(r2)];
    if (inD(p)) samplesD.push(p);
  }
  for (const p of samplesD) {
    for (let i = 0; i < NF; i++) {
      const q = apply(H[i], p);
      if (inD(q, -1e-12)) bad++; // must not lie in D
      if (!(mink(N[i], q) > -1e-12)) bad++; // must lie beyond face i
      for (let j = 0; j < NF; j++) if (j !== i && inD(apply(G[j], q), -1e-12)) bad++; // and not in another neighbour
    }
  }
  console.log(`samples in D: ${nS}; violations: ${bad}`);

  section("Dirichlet domain and full tiling of a ball");
  const t0 = Date.now();
  const mats = enumerate(rCirc + 3.0);
  console.log(`enumerated ${mats.length} elements with d(o,γo) ≤ ${(rCirc + 3).toFixed(3)} in ${Date.now() - t0} ms`);
  const inv = mats.map(minv);
  // Dirichlet: for p in D, d(p,o) ≤ d(p,γo) for all γ.
  let dirBad = 0;
  for (const p of samplesD.slice(0, 3000)) {
    const d0 = hdist(p, O);
    for (let k = 1; k < mats.length; k++) {
      const go = [mats[k][3], mats[k][7], mats[k][11], mats[k][15]];
      if (hdist(p, go) < d0 - 1e-12) { dirBad++; break; }
    }
  }
  console.log("Dirichlet violations (3000 points):", dirBad);
  // Tiling: points in the ball of radius 3 around o lie in exactly one cell γD (γ in the set suffices: d(o,γo) ≤ 3 + R_c).
  const counts = new Map<number, number>();
  for (let s = 0; s < 20000; s++) {
    const r = 3 * Math.cbrt(rand()); const u = randUnit3();
    const p: V4 = [u[0] * Math.sinh(r), u[1] * Math.sinh(r), u[2] * Math.sinh(r), Math.cosh(r)];
    let c = 0;
    for (let k = 0; k < mats.length; k++) if (inD(apply(inv[k], p), 0)) c++;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  console.log("cells containing each of 20000 points within distance 3 of o (count → points):", Object.fromEntries(counts));

  section("volume by Monte Carlo");
  let hit = 0; const M = 400000;
  for (let s = 0; s < M; s++) {
    // uniform in hyperbolic ball B(R_c): ρ by rejection on sinh²
    let r: number;
    do { r = rCirc * rand(); } while (rand() > (Math.sinh(r) / Math.sinh(rCirc)) ** 2);
    const u = randUnit3();
    if (inD([u[0] * Math.sinh(r), u[1] * Math.sinh(r), u[2] * Math.sinh(r), Math.cosh(r)])) hit++;
  }
  const vb = Math.PI * (Math.sinh(2 * rCirc) - 2 * rCirc);
  const vol = (vb * hit) / M; const se = vb * Math.sqrt((hit / M) * (1 - hit / M) / M);
  console.log(`vol(D) ≈ ${vol.toFixed(4)} ± ${se.toFixed(4)} (Seifert–Weber volume 11.1990647 from memory)`);
}

// ======================================================================
// Teleporting a geodesic through D. Exit through face i at τ = tanh t = −<N_i,p>/<N_i,v> (smallest τ ≥ 0 over faces with
// <N_i,v> > 0); the exit point is (p + τ v)/√(1−τ²), the direction (v + τ p)/√(1−τ²). No cosh/sinh needed.
type RayState = { p: V4; v: V4; t: number; faces: number[] };
function step(s: RayState, Nn: V4[], Gg: M4[], r: Rnd, renorm: boolean): { face: number; tau: number } {
  let best = Infinity, face = -1;
  for (let i = 0; i < NF; i++) {
    const b = mink(Nn[i], s.v, r);
    if (b <= 0) continue;
    const a = mink(Nn[i], s.p, r);
    const tau = Math.max(r(-a / b), 0);
    if (tau < best) { best = tau; face = i; }
  }
  if (face < 0 || best >= 1) throw new Error(`no exit: best=${best}`);
  let p = s.p.map((x, c) => r(x + r(best * s.v[c])));
  let v = s.v.map((x, c) => r(x + r(best * s.p[c])));
  if (renorm) {
    const sp = r(1 / r(Math.sqrt(r(-mink(p, p, r)))));
    p = p.map((x) => r(x * sp));
    const pv = mink(v, p, r);
    v = v.map((x, c) => r(x + r(pv * p[c])));
    const sv = r(1 / r(Math.sqrt(mink(v, v, r))));
    v = v.map((x) => r(x * sv));
  } else {
    const sc = r(1 / r(Math.sqrt(r(r(1 - best) * r(1 + best)))));
    p = p.map((x) => r(x * sc)); v = v.map((x) => r(x * sc));
  }
  s.t = s.t + Math.atanh(best);
  s.p = apply(Gg[face], p, r); s.v = apply(Gg[face], v, r);
  s.faces.push(face);
  return { face, tau: best };
}
function randomStart(): RayState {
  let p: V4;
  do {
    const r = rCirc * Math.cbrt(rand()); const u = randUnit3();
    p = [u[0] * Math.sinh(r), u[1] * Math.sinh(r), u[2] * Math.sinh(r), Math.cosh(r)];
  } while (!inD(p));
  // random unit tangent at p: parallel-transport a random direction from o by the translation o→p
  const d = randUnit3();
  const ch = p[3], sp = [p[0], p[1], p[2]];
  // tangent at p: v = (d + (d·sp)/(1+ch) sp, d·sp)
  const ds = d[0] * sp[0] + d[1] * sp[1] + d[2] * sp[2];
  const v: V4 = [d[0] + (ds / (1 + ch)) * sp[0], d[1] + (ds / (1 + ch)) * sp[1], d[2] + (ds / (1 + ch)) * sp[2], ds];
  return { p, v, t: 0, faces: [] };
}

function teleport() {
  const N32 = N.map((n) => n.map(Math.fround));
  const G32 = G.map(round32);
  section("float32 generator matrices");
  console.log("max SO(3,1) defect of float32-rounded generators:", Math.max(...G32.map(isomDefect)).toExponential(3), " (float64:", Math.max(...G.map(isomDefect)).toExponential(3), ")");

  for (const [label, r, Nn, Gg] of [["float64", id, N, G], ["float32", f32, N32, G32]] as const) {
    for (const renorm of [false, true]) {
      for (const nTel of [100, 1000]) {
        const nRays = nTel === 100 ? 2000 : 300;
        let eP = 0, eV = 0, ePV = 0, out = 0, zeroSteps = 0, maxZeroRun = 0, fails = 0, tot = 0;
        for (let k = 0; k < nRays; k++) {
          const s = randomStart();
          s.p = s.p.map(r); s.v = s.v.map(r);
          let run = 0;
          try {
            for (let n = 0; n < nTel; n++) {
              const { tau } = step(s, Nn as V4[], Gg as M4[], r, renorm);
              if (tau === 0) { zeroSteps++; run++; maxZeroRun = Math.max(maxZeroRun, run); } else run = 0;
              eP = Math.max(eP, Math.abs(mink(s.p, s.p) + 1));
              eV = Math.max(eV, Math.abs(mink(s.v, s.v) - 1));
              ePV = Math.max(ePV, Math.abs(mink(s.p, s.v)));
              out = Math.max(out, outside(s.p));
            }
          } catch (e) { fails++; }
          tot += s.t;
        }
        console.log(`${label} renorm=${renorm} ${nTel} teleports × ${nRays} rays: max|<p,p>+1| ${eP.toExponential(2)}  max|<v,v>-1| ${eV.toExponential(2)}  max|<p,v>| ${ePV.toExponential(2)}  max sinh(dist outside D) ${out.toExponential(2)}  zero-length crossings ${zeroSteps} (longest run ${maxZeroRun})  failures ${fails}  mean length/teleport ${(tot / nRays / nTel).toFixed(4)}`);
      }
    }
  }

  section("edge- and vertex-grazing rays (float32, renormalised)");
  {
    let zero = 0, maxRun = 0, fails = 0, out = 0, n = 0;
    for (let k = 0; k < 4000; k++) {
      // aim from a random point of D exactly at a vertex or an edge midpoint
      const s = randomStart();
      let target: V4;
      if (k % 2 === 0) target = V[Math.floor(rand() * V.length)];
      else {
        const a = V[Math.floor(rand() * V.length)];
        // nearest other vertex sharing two faces = edge partner
        const fa = facesOfVertex(a);
        const partner = V.find((b) => b !== a && facesOfVertex(b).filter((f) => fa.includes(f)).length === 2)!;
        const m = a.map((x, c) => x + partner[c]); const sc = 1 / Math.sqrt(-mink(m, m));
        target = m.map((x) => x * sc);
      }
      // direction at p toward target: (target + <target,p> p) normalised
      const tp = mink(target, s.p);
      const v = target.map((x, c) => x + tp * s.p[c]); const nv = Math.sqrt(mink(v, v));
      s.v = v.map((x) => f32(x / nv)); s.p = s.p.map(f32);
      let run = 0;
      try {
        for (let j = 0; j < 30; j++) {
          const { tau } = step(s, N.map((x) => x.map(f32)), G.map(round32), f32, true);
          n++;
          if (tau === 0) { zero++; run++; maxRun = Math.max(maxRun, run); } else run = 0;
          out = Math.max(out, outside(s.p));
        }
      } catch { fails++; }
    }
    console.log(`4000 rays aimed at vertices/edge midpoints, 30 crossings each: zero-length crossings ${zero}/${n} (longest run ${maxRun}), failures ${fails}, max sinh(dist outside D) ${out.toExponential(2)}`);
  }

  section("float32 vs float64 teleported rays, crossing by crossing (D frame), against the pixel footprint");
  // Both rays start from the same (p,v) in D. While they choose the same faces, compare after each crossing:
  //   along-track: |t32 − t64| (accumulated arc length);
  //   cross-track: chord distance between p64 and p32 slid along its own geodesic by (t64 − t32).
  // The pixel footprint of a 1e-3 rad pixel at arc length T is sinh(T)·1e-3 (exact for H³, small angle).
  {
    const chord = (a: V4, b: V4) => { const d = a.map((x, c) => x - b[c]); return 2 * Math.asinh(Math.sqrt(Math.max(0, mink(d, d))) / 2); };
    const Ts = [1, 2, 4, 6, 8, 10, 12, 14];
    const along = Ts.map(() => [] as number[]); const cross = Ts.map(() => [] as number[]);
    let diverged = 0; const divergeT: number[] = [];
    const N32 = N.map((x) => x.map(f32)), G32 = G.map(round32);
    for (let k = 0; k < 2000; k++) {
      const s0 = randomStart();
      const a: RayState = { p: s0.p.slice(), v: s0.v.slice(), t: 0, faces: [] };
      const b: RayState = { p: s0.p.map(f32), v: s0.v.map(f32), t: 0, faces: [] };
      let ti = 0;
      while (ti < Ts.length) {
        step(a, N, G, id, true); step(b, N32, G32, f32, true);
        if (a.faces[a.faces.length - 1] !== b.faces[b.faces.length - 1]) { diverged++; divergeT.push(a.t); break; }
        if (a.t >= Ts[ti]) {
          const dt = a.t - b.t;
          const slid = b.p.map((x, c) => Math.cosh(dt) * x + Math.sinh(dt) * b.v[c]);
          along[ti].push(Math.abs(dt)); cross[ti].push(chord(slid, a.p));
          ti++;
        }
      }
    }
    const q = (arr: number[], f: number) => { const s = arr.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
    for (let i = 0; i < Ts.length; i++) {
      if (!cross[i].length) continue;
      const pix = Math.sinh(Ts[i]) * 1e-3;
      console.log(`T≈${Ts[i]} (n=${cross[i].length}): cross-track median ${q(cross[i], 0.5).toExponential(2)} p99 ${q(cross[i], 0.99).toExponential(2)} max ${Math.max(...cross[i]).toExponential(2)} | along-track median ${q(along[i], 0.5).toExponential(2)} max ${Math.max(...along[i]).toExponential(2)} | pixel footprint ${pix.toExponential(2)} | max cross / pixel ${(Math.max(...cross[i]) / pix).toExponential(2)}`);
    }
    console.log(`face sequences diverged (different face chosen) in ${diverged}/2000 rays before T=14; arc length at divergence: median ${divergeT.length ? q(divergeT, 0.5).toFixed(2) : "-"}, min ${divergeT.length ? Math.min(...divergeT).toFixed(2) : "-"}`);
  }

  section("float32 arc-length bookkeeping: per-segment error against float64 from the same float32 state");
  {
    const N32 = N.map((x) => x.map(f32)), G32 = G.map(round32);
    const per: number[] = []; const sums: number[] = []; let sameFace = 0, tot = 0;
    for (let k = 0; k < 1000; k++) {
      const s0 = randomStart();
      const b: RayState = { p: s0.p.map(f32), v: s0.v.map(f32), t: 0, faces: [] };
      let sum = 0;
      for (let n = 0; n < 100; n++) {
        const ref: RayState = { p: b.p.slice(), v: b.v.slice(), t: 0, faces: [] };
        // float64 step from the same (float32) state, without the pairing's effect on t
        let best = Infinity, face = -1;
        for (let i = 0; i < NF; i++) { const bb = mink(N[i], ref.v); if (bb <= 0) continue; const tau = Math.max(-mink(N[i], ref.p) / bb, 0); if (tau < best) { best = tau; face = i; } }
        const t0 = b.t; step(b, N32, G32, f32, true);
        tot++; if (b.faces[b.faces.length - 1] === face) sameFace++;
        const e = Math.abs((b.t - t0) - Math.atanh(best)); per.push(e); sum += e;
      }
      sums.push(sum);
    }
    const q = (arr: number[], f: number) => { const s = arr.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
    console.log(`per-segment |t32 − t64|: median ${q(per, 0.5).toExponential(2)} p99 ${q(per, 0.99).toExponential(2)} p99.99 ${q(per, 0.9999).toExponential(2)} max ${Math.max(...per).toExponential(2)}; same exit face ${sameFace}/${tot}`);
    console.log(`summed over 100 segments (~96 length units): median ${q(sums, 0.5).toExponential(2)} max ${Math.max(...sums).toExponential(2)}`);
  }

  section("NEE aim to a precomputed float32 image matrix (no runtime products)");
  {
    // γ computed in float64 as a word, rounded ONCE to float32 (a const table). Light point y in D, shading point x in D.
    // Direction at x toward γy and the distance, computed in float32 from the rounded matrix, against float64.
    const res: Record<string, { ang: number; dd: number }> = {};
    for (let k = 0; k < 3000; k++) {
      let P = eye(); const L = 1 + Math.floor(rand() * 5); let last = -1;
      for (let j = 0; j < L; j++) { let i: number; do { i = Math.floor(rand() * NF); } while (i === opp(last)); last = i; P = mul(P, G[i]); }
      const x = randomStart().p, y = randomStart().p;
      const gy = apply(P, y); const gy32 = apply(round32(P), y.map(f32), f32);
      const dirOf = (z: V4, xx: V4, r: Rnd) => { const c = mink(z, xx, r); const w = z.map((zz, i) => r(zz + r(c * xx[i]))); const n = r(Math.sqrt(mink(w, w, r))); return { w: w.map((ww) => r(ww / n)), d: Math.acosh(Math.max(1, -c)) }; };
      const A = dirOf(gy, x, id), B = dirOf(gy32, x.map(f32), f32);
      const dw = A.w.map((u, i) => u - B.w[i]); const ang = 2 * Math.asin(Math.min(1, Math.sqrt(Math.abs(mink(dw, dw))) / 2)); // chord, not acos near 1
      const bin = `d(x,γy) ${Math.floor(A.d / 2) * 2}–${Math.floor(A.d / 2) * 2 + 2}`;
      const r0 = res[bin] ?? { ang: 0, dd: 0 }; r0.ang = Math.max(r0.ang, ang); r0.dd = Math.max(r0.dd, Math.abs(A.d - B.d) / A.d); res[bin] = r0;
    }
    for (const [k, v] of Object.entries(res).sort()) console.log(`${k}: max aim angle error ${v.ang.toExponential(2)} rad, max relative distance error ${v.dd.toExponential(2)}`);
  }

  section("accumulated products (a cellBoost) in float32");
  {
    for (const L of [2, 5, 10, 20, 40]) {
      let worstRel = 0, worstDef = 0, worstDist = 0;
      for (let k = 0; k < 200; k++) {
        let P64 = eye(), P32 = eye();
        // random reduced word (no immediate cancellation)
        let last = -1;
        for (let j = 0; j < L; j++) {
          let i: number; do { i = Math.floor(rand() * NF); } while (i === opp(last));
          last = i;
          P64 = mul(P64, G[i]); P32 = mul(P32, round32(G[i]), f32);
        }
        const rel = maxAbsDiff(P64, P32) / maxAbs(P64);
        worstRel = Math.max(worstRel, rel);
        worstDef = Math.max(worstDef, isomDefect(P32) / maxAbs(P64) ** 2);
        // where does the float32 product send o, compared with the true γo?
        const a = apply(P64, O), b = apply(P32, O);
        b[3] = Math.sqrt(1 + b[0] ** 2 + b[1] ** 2 + b[2] ** 2); // project onto H³ keeping the spatial part
        const dlt = a.map((x, c) => x - b[c]);
        worstDist = Math.max(worstDist, 2 * Math.asinh(Math.sqrt(Math.max(0, mink(dlt, dlt))) / 2));
      }
      console.log(`word length ${L} (d(o,γo) up to ~${(2*rIn*L).toFixed(0)}): max relative entry error ${worstRel.toExponential(2)}, SO(3,1) defect/‖P‖² ${worstDef.toExponential(2)}, d(γo, γ̃o) ${worstDist.toExponential(2)}`);
    }
  }
}

// ======================================================================
function count() {
  section("image counts N(R) = #{γ : d(o, γo) ≤ R}, systole");
  const vol = 11.1990647;
  const t0 = Date.now();
  const R = 6;
  const mats = enumerate(R + rCirc);
  console.log(`enumerated ${mats.length} elements with d(o,γo) ≤ R + R_c = ${(R + rCirc).toFixed(3)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const ds = mats.map((M) => Math.acosh(Math.max(1, M[15])));
  for (const r of [1, 2, 3, 4, 5, 6]) {
    const n = ds.filter((d) => d <= r).length;
    const pred = (Math.PI * (Math.sinh(2 * r) - 2 * r)) / vol;
    console.log(`R=${r}: N(R) = ${n}   vol(B_R)/vol(M) = ${pred.toFixed(1)}   ratio ${(n / pred).toFixed(3)}`);
  }
  // shortest nonzero orbit distances (from o) — injectivity radius at o is half the first one
  const sorted = ds.slice(1).sort((a, b) => a - b);
  const distinct: [number, number][] = [];
  for (const d of sorted) { const l = distinct[distinct.length - 1]; if (l && Math.abs(l[0] - d) < 1e-6) l[1]++; else distinct.push([d, 1]); }
  console.log("first orbit distances d(o,γo) with multiplicity:", distinct.slice(0, 6).map(([d, m]) => `${d.toFixed(6)}×${m}`));
  // translation length: char. poly λ⁴ − aλ³ + bλ² − aλ + 1, μ = λ + 1/λ solves μ² − aμ + (b−2) = 0; 2cosh ℓ = max root.
  let best = Infinity; const lens: { l: number; th: number; d: number }[] = [];
  for (let k = 1; k < mats.length; k++) {
    const M = mats[k];
    const a = M[0] + M[5] + M[10] + M[15];
    let tr2 = 0; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) tr2 += M[4 * i + j] * M[4 * j + i];
    const b = (a * a - tr2) / 2;
    const disc = Math.max(0, a * a - 4 * (b - 2));
    const mu1 = (a + Math.sqrt(disc)) / 2, mu2 = (a - Math.sqrt(disc)) / 2;
    const l = Math.acosh(Math.max(1, mu1 / 2));
    const th = Math.acos(Math.max(-1, Math.min(1, mu2 / 2)));
    lens.push({ l, th, d: ds[k] });
    best = Math.min(best, l);
  }
  lens.sort((x, y) => x.l - y.l);
  const groups: { l: number; th: number; n: number; dmin: number }[] = [];
  for (const e of lens) { const g = groups[groups.length - 1]; if (g && Math.abs(g.l - e.l) < 1e-6 && Math.abs(g.th - e.th) < 1e-6) { g.n++; g.dmin = Math.min(g.dmin, e.d); } else groups.push({ l: e.l, th: e.th, n: 1, dmin: e.d }); }
  console.log("shortest translation lengths (complex length ℓ + iθ) among enumerated elements:");
  for (const g of groups.slice(0, 6)) console.log(`  ℓ = ${g.l.toFixed(9)}  θ = ${(g.th * 180 / Math.PI).toFixed(4)}°  elements ${g.n}  min d(o,γo) ${g.dmin.toFixed(4)}`);
  console.log(`certified: any γ with ℓ(γ) ≤ L has a conjugate with d(o,γo) ≤ L + 2R_c; the set reaches ${(R + rCirc).toFixed(3)}, so lengths ≤ ${(R + rCirc - 2 * rCirc).toFixed(3)} are complete.`);
  return mats;
}

// ======================================================================
function diam() {
  section("diameter of M (max over pairs of d_M(x,y))");
  const mats = enumerate(2 * rCirc + 2.2);
  const orb = mats.map((M) => ({ M, d: Math.acosh(Math.max(1, M[15])) })).sort((a, b) => a.d - b.d);
  const reach = 2 * rCirc + 2.2;
  console.log(`using ${orb.length} elements with d(o,γo) ≤ ${reach.toFixed(3)}`);
  // d_M(x,y) = min_γ d(x, γy); any minimiser has d(o,γo) ≤ d(o,x) + d_M + d(o,y) ≤ 2R_c + d_M, so the set is complete while d_M ≤ 2.2.
  const dM = (x: V4, y: V4) => {
    let best = Infinity; const dx = hdist(O, x), dy = hdist(O, y);
    for (const { M, d } of orb) {
      if (d - dx - dy >= best) break;
      const v = hdist(x, apply(M, y));
      if (v < best) best = v;
    }
    return best;
  };
  const randD = () => { for (;;) { const s = randomStart(); return s.p; } };
  let bestVal = 0, bestPair: [V4, V4] = [O, O];
  // start points: o, vertices, edge midpoints, face centres, random
  const cands: V4[] = [O, ...V];
  for (let i = 0; i < 400; i++) cands.push(randD());
  for (let i = 0; i < cands.length; i++) for (let j = i; j < Math.min(cands.length, i + 60); j++) {
    const v = dM(cands[i], cands[j]); if (v > bestVal) { bestVal = v; bestPair = [cands[i], cands[j]]; }
  }
  // local hill climbing on both points
  const jiggle = (p: V4, s: number): V4 => {
    const w = randUnit3(); const q: V4 = [p[0] + s * w[0], p[1] + s * w[1], p[2] + s * w[2], 0];
    q[3] = Math.sqrt(1 + q[0] ** 2 + q[1] ** 2 + q[2] ** 2); return q;
  };
  for (const s of [0.2, 0.05, 0.01, 0.002]) for (let it = 0; it < 800; it++) {
    const x = jiggle(bestPair[0], s), y = jiggle(bestPair[1], s);
    const v = dM(x, y); if (v > bestVal) { bestVal = v; bestPair = [x, y]; }
  }
  console.log(`max d_M found ${bestVal.toFixed(6)} (R_c = ${rCirc.toFixed(6)}); the pair: d(o,x) ${hdist(O, bestPair[0]).toFixed(4)}, d(o,y) ${hdist(O, bestPair[1]).toFixed(4)}`);
  console.log(`  d_M(o, vertex) = ${dM(O, V[0]).toFixed(6)}`);
}

const which = process.argv[2] ?? "all";
if (which === "geom" || which === "all") geom();
if (which === "tile" || which === "all") tile();
if (which === "teleport" || which === "all") teleport();
if (which === "diam" || which === "all") diam();
if (which === "count" || which === "all") count();
