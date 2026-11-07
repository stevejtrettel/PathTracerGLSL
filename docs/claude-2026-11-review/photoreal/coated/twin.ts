// Scratch twin of the proposed `plastic` model (Mitsuba 3 plastic.cpp, nonlinear=true),
// written in the local shading frame (n = +z). Run: npx tsx twin.ts
type V = [number, number, number];

function fresnel(cosI: number, eta: number): number {      // eta = n_i / n_t (house convention)
    const s2 = eta * eta * (1 - cosI * cosI);
    if (s2 >= 1) return 1;
    const ct = Math.sqrt(1 - s2);
    const rp = (cosI - eta * ct) / (cosI + eta * ct);
    const rs = (eta * cosI - ct) / (eta * cosI + ct);
    return 0.5 * (rp * rp + rs * rs);
}

// ∫_0^1 F(μ, eta) 2μ dμ by composite Gauss–Legendre, split at the critical cosine.
const GL = (() => {   // 16-point nodes/weights on [-1,1]
    const x = [0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.7554044083550030, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499];
    const w = [0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767, 0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541];
    return { x: [...x.map(v => -v), ...x], w: [...w, ...w] };
})();
function integrate(f: (m: number) => number, a: number, b: number, pieces = 64): number {
    let s = 0;
    const h = (b - a) / pieces;
    for (let k = 0; k < pieces; k++) {
        const lo = a + k * h, mid = lo + h / 2;
        for (let j = 0; j < GL.x.length; j++) s += GL.w[j] * f(mid + GL.x[j] * h / 2) * h / 2;
    }
    return s;
}
// eta is n_i/n_t; the crossing below μc is TIR (F=1) when eta > 1.
function fdr(eta: number): number {
    const mc = eta > 1 ? Math.sqrt(1 - 1 / (eta * eta)) : 0;
    const g = (m: number) => fresnel(m, eta) * 2 * m;
    return (mc > 0 ? integrate(g, 0, mc) : 0) + integrate(g, mc, 1);
}

// The model. coatIor = η (coat over the outside medium). Outside → coat: eta_ext = 1/η.
interface MP { R: number[]; eta: number; K: number }
function make(R: number[], eta: number): MP { return { R, eta, K: fdr(eta) }; }   // K: internal, n_i/n_t = η
const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
function pSpec(mp: MP, ci: number) {
    const Fi = fresnel(ci, 1 / mp.eta);
    const s = Fi, d = (1 - Fi) * avg(mp.R);
    return s / Math.max(s + d, 1e-30);   // Mitsuba: weight = s/(d+s) on (F, 1-F) prob terms
}
function evalF(mp: MP, wi: V, wo: V): number[] {
    if (wi[2] <= 0 || wo[2] <= 0) return mp.R.map(() => 0);
    const Fi = fresnel(wo[2], 1 / mp.eta), Fo = fresnel(wi[2], 1 / mp.eta);
    return mp.R.map(r => r / (1 - r * mp.K) * (1 - Fi) * (1 - Fo) / (Math.PI * mp.eta * mp.eta));
}
function pdf(mp: MP, wi: V, wo: V): number {
    if (wi[2] <= 0 || wo[2] <= 0) return 0;
    return (1 - pSpec(mp, wo[2])) * wi[2] / Math.PI;
}
function sample(mp: MP, wo: V, uc: number, u: [number, number]) {
    const ps = pSpec(mp, wo[2]);
    const Fo = fresnel(wo[2], 1 / mp.eta);
    if (uc < ps) {
        return { wi: [-wo[0], -wo[1], wo[2]] as V, weight: mp.R.map(() => Fo / ps), pdf: 0, delta: true };
    }
    const ct = Math.sqrt(u[1]), st = Math.sqrt(1 - u[1]), ph = 2 * Math.PI * u[0];
    const wi: V = [st * Math.cos(ph), st * Math.sin(ph), ct];
    const Fi = fresnel(ct, 1 / mp.eta);
    const pd = 1 - ps;
    const weight = mp.R.map(r => r / (1 - r * mp.K) * (1 - Fo) * (1 - Fi) / (mp.eta * mp.eta) / pd);
    return { wi, weight, pdf: pd * ct / Math.PI, delta: false };
}

// ---------------------------------------------------------------------------
let rng = 12345 >>> 0;
const rnd = () => { rng = (rng + 0x6D2B79F5) >>> 0; let t = rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };   // mulberry32

console.log('--- 1. Fdr identity  1 - K_int = (1 - Fdr_ext)/η²  (K_int uses eta=η, ext uses 1/η)');
for (const eta of [1.0001, 1.33, 1.5, 1.6, 2.0, 2.5]) {
    const Kint = fdr(eta), Fext = fdr(1 / eta);
    console.log(`η=${eta}: K_int=${Kint.toFixed(8)} Fdr_ext=${Fext.toFixed(8)} lhs=${(1 - Kint).toFixed(10)} rhs=${((1 - Fext) / (eta * eta)).toFixed(10)}`);
}

const eta = 1.5;
console.log('\n--- 2. Directional albedo A(μ) = F + (1-F) R(1-K)/(1-RK): closed form vs MC of sample weights vs quadrature of eval');
for (const R of [[1, 1, 1], [0.5, 0.5, 0.5], [0.8, 0.5, 0.2]]) {
    const mp = make(R, eta);
    for (const mu of [1, 0.7, 0.3, 0.05]) {
        const wo: V = [Math.sqrt(1 - mu * mu), 0, mu];
        const F = fresnel(mu, 1 / eta);
        const closed = R.map(r => F + (1 - F) * r * (1 - mp.K) / (1 - r * mp.K));
        const N = 400000; const acc = R.map(() => 0);
        for (let n = 0; n < N; n++) { const s = sample(mp, wo, rnd(), [rnd(), rnd()]); s.weight.forEach((w, c) => acc[c] += w / N); }
        // quadrature of the diffuse eval over the hemisphere + delta F
        const quad = R.map((_, c) => F + integrate(m => evalF(mp, [Math.sqrt(1 - m * m), 0, m], wo)[c] * m * 2 * Math.PI, 0, 1));
        console.log(`R=${R} μ=${mu}: closed=${closed.map(x => x.toFixed(5))} MC=${acc.map(x => x.toFixed(5))} quad=${quad.map(x => x.toFixed(5))}`);
    }
}

console.log('\n--- 3. Triple: weight·pdf = eval·cos for diffuse samples; pdf(sample.wi)=sample.pdf; reciprocity');
{
    const mp = make([0.8, 0.5, 0.2], eta); let maxRel = 0, maxPdf = 0, maxRec = 0;
    for (let n = 0; n < 100000; n++) {
        const mu = rnd(); const ph = 2 * Math.PI * rnd();
        const wo: V = [Math.sqrt(1 - mu * mu) * Math.cos(ph), Math.sqrt(1 - mu * mu) * Math.sin(ph), mu];
        const s = sample(mp, wo, rnd(), [rnd(), rnd()]);
        if (s.delta) continue;
        const f = evalF(mp, s.wi, wo);
        f.forEach((fc, c) => { maxRel = Math.max(maxRel, Math.abs(s.weight[c] * s.pdf - fc * s.wi[2]) / (fc * s.wi[2])); });
        maxPdf = Math.max(maxPdf, Math.abs(pdf(mp, s.wi, wo) - s.pdf) / s.pdf);
        const fr = evalF(mp, wo, s.wi); f.forEach((fc, c) => maxRec = Math.max(maxRec, Math.abs(fc - fr[c]) / fc));
    }
    console.log(`max rel triple err=${maxRel.toExponential(2)} pdf err=${maxPdf.toExponential(2)} reciprocity err=${maxRec.toExponential(2)}`);
}

console.log('\n--- 4. χ² of the non-delta sample against pdf (θ×φ bins, 10×20), conditional on the diffuse branch');
{
    const mp = make([0.5, 0.5, 0.5], eta);
    for (const mu of [0.9, 0.3]) {
        const wo: V = [Math.sqrt(1 - mu * mu), 0, mu];
        const NT = 10, NP = 20, N = 500000; const obs = new Array(NT * NP).fill(0); let nd = 0;
        for (let n = 0; n < N; n++) { const s = sample(mp, wo, rnd(), [rnd(), rnd()]); if (s.delta) continue; nd++;
            const t = Math.acos(Math.min(1, s.wi[2])), p = (Math.atan2(s.wi[1], s.wi[0]) + 2 * Math.PI) % (2 * Math.PI);
            obs[Math.min(NT - 1, Math.floor(t / (Math.PI / 2) * NT)) * NP + Math.min(NP - 1, Math.floor(p / (2 * Math.PI) * NP))]++; }
        // expected: N · ∫_bin pdf dω (pdf includes P(diffuse), so it counts out of N, not nd)
        let chi = 0;
        for (let i = 0; i < NT; i++) for (let j = 0; j < NP; j++) {
            const t0 = i * Math.PI / 2 / NT, t1 = (i + 1) * Math.PI / 2 / NT;
            const e = N * (2 * Math.PI / NP) * integrate(t => pdf(mp, [Math.sin(t), 0, Math.cos(t)], wo) * Math.sin(t), t0, t1, 4);
            chi += (obs[i * NP + j] - e) ** 2 / e;
        }
        const ps = pSpec(mp, mu);
        console.log(`μ=${mu}: χ²=${chi.toFixed(1)} (dof ${NT * NP - 1}); P(delta)=${ps.toFixed(4)} observed=${(1 - nd / N).toFixed(4)}`);
    }
}

console.log('\n--- 5. Witness derived values (η=1.5)');
{
    const K = fdr(1.5); const F0 = fresnel(1, 1 / 1.5);
    console.log(`K=Fdr_int(1.5)=${K.toFixed(6)}  F0=${F0.toFixed(6)}`);
    for (const r of [1, 0.5, 0.8, 0.2]) {
        const A = (mu: number) => { const F = fresnel(mu, 1 / 1.5); return F + (1 - F) * r * (1 - K) / (1 - r * K); };
        console.log(`R=${r}: A(1)=${A(1).toFixed(6)}  A(0.99)=${A(0.99).toFixed(6)}  A(0.98)=${A(0.98).toFixed(6)}  linear(Mitsuba default)=${(F0 + (1 - F0) * r).toFixed(6)}`);
    }
    // η = 1 must reduce to Lambert: f = R/π
    const mp1 = make([0.5, 0.5, 0.5], 1.0);
    console.log(`η=1: K=${mp1.K.toExponential(2)} f=${evalF(mp1, [0, 0, 1], [0.6, 0, 0.8])[0].toFixed(8)} R/π=${(0.5 / Math.PI).toFixed(8)} pSpec=${pSpec(mp1, 0.5)}`);
}
