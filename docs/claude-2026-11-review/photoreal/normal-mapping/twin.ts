// Scratch twin for the normal-mapping plan: bump perturbation + Schüssler flip + ng mask
// (Mitsuba 3 perturbed_bsdf.h semantics, with ng as the mask's base normal), over
// Lambert and GGX. Local world frame: ng = +z. Run: npx tsx twin.ts
type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => mul(a, 1 / Math.hypot(...a));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const NG: V3 = [0, 0, 1];

// seeded rng (mulberry32)
let seed = 12345;
function rnd() { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
function uniformSphere(): V3 { const z = 1 - 2 * rnd(); const r = Math.sqrt(Math.max(0, 1 - z * z)); const ph = 2 * Math.PI * rnd(); return [r * Math.cos(ph), r * Math.sin(ph), z]; }
function upperHemi(): V3 { const w = uniformSphere(); return [w[0], w[1], Math.abs(w[2])]; }

function frameOf(n: V3): { t: V3; b: V3; n: V3 } {
    const t0: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const t = norm(sub(t0, mul(n, dot(t0, n))));
    return { t, b: cross(n, t), n };
}

// The perturbation. base = frame.n (here ng), gS = surface gradient of h (tangent to base),
// sigma = +1 when frame.n is the owner's outward normal.
function perturb(base: V3, gS: V3, sigma: number, wo: V3): V3 {
    let np = norm(sub(base, mul(gS, sigma)));
    if (dot(wo, np) <= 0) {                       // Schüssler flip: mirror the tangential part
        const z = dot(np, base);
        np = norm(sub(mul(base, 2 * z), np));     // z·n − τ  =  2(n'·n)n − n'
    }
    return np;
}
const mask = (wi: V3, nf: V3) => dot(wi, NG) * dot(wi, nf) > 0;

// ---- Lambert in frame nf ----
function lambertEval(wi: V3, wo: V3, nf: V3, rho: number) { return dot(wi, nf) * dot(wo, nf) > 0 && mask(wi, nf) ? rho / Math.PI : 0; }
function lambertPdf(wi: V3, wo: V3, nf: V3) { const c = dot(wi, nf) * Math.sign(dot(wo, nf)); return c > 0 && mask(wi, nf) ? c / Math.PI : 0; }
function lambertSample(wo: V3, nf: V3, rho: number) {
    const f = frameOf(nf); const n = dot(wo, nf) < 0 ? mul(nf, -1) : nf;
    const u1 = rnd(), u2 = rnd(); const ct = Math.sqrt(u2), st = Math.sqrt(1 - u2), ph = 2 * Math.PI * u1;
    const wi = norm(add(add(mul(f.t, st * Math.cos(ph)), mul(f.b, st * Math.sin(ph))), mul(n, ct)));
    if (!mask(wi, nf)) return { wi, weight: 0, pdf: 0 };
    return { wi, weight: rho, pdf: ct / Math.PI };
}

// ---- GGX (transcribed from ggx.test.ts twin), evaluated in frame nf ----
const toL = (v: V3, F: ReturnType<typeof frameOf>): V3 => [dot(v, F.t), dot(v, F.b), dot(v, F.n)];
const fromL = (v: V3, F: ReturnType<typeof frameOf>): V3 => norm(add(add(mul(F.t, v[0]), mul(F.b, v[1])), mul(F.n, v[2])));
function D(h: V3, a: number) { const t = h[2] * h[2] * (a * a - 1) + 1; return a * a / (Math.PI * t * t); }
function G1(v: V3, a: number) { const c = Math.abs(v[2]); return 2 * c / (c + Math.sqrt(a * a + (1 - a * a) * c * c)); }
function ggxEval(wi: V3, wo: V3, nf: V3, a: number) {
    if (!mask(wi, nf)) return 0;
    const F = frameOf(nf); const il = toL(wi, F), ol = toL(wo, F);
    if (il[2] * ol[2] <= 0) return 0; const h = norm(add(il, ol));
    return D(h, a) * G1(il, a) * G1(ol, a) / (4 * Math.abs(il[2]) * Math.abs(ol[2]));   // f0 = 1
}
function ggxPdf(wi: V3, wo: V3, nf: V3, a: number) {
    if (!mask(wi, nf)) return 0;
    const F = frameOf(nf); const il = toL(wi, F), ol = toL(wo, F);
    if (il[2] * ol[2] <= 0) return 0; const h = norm(add(il, ol));
    return G1(ol, a) * D(h, a) / (4 * Math.abs(ol[2]));
}
function vndf(wol: V3, a: number, u: [number, number]): V3 {
    const vh = norm([a * wol[0], a * wol[1], wol[2]]); const lensq = vh[0] * vh[0] + vh[1] * vh[1];
    const T1: V3 = lensq > 0 ? mul([-vh[1], vh[0], 0], 1 / Math.sqrt(lensq)) : [1, 0, 0]; const T2 = cross(vh, T1);
    const rr = Math.sqrt(u[0]), phi = 2 * Math.PI * u[1]; const t1 = rr * Math.cos(phi); let t2 = rr * Math.sin(phi);
    const s = 0.5 * (1 + vh[2]); t2 = (1 - s) * Math.sqrt(Math.max(0, 1 - t1 * t1)) + s * t2;
    const nh = add(add(mul(T1, t1), mul(T2, t2)), mul(vh, Math.sqrt(Math.max(0, 1 - t1 * t1 - t2 * t2))));
    return norm([a * nh[0], a * nh[1], Math.max(1e-6, nh[2])]);
}
function ggxSample(wo: V3, nf: V3, a: number) {
    const F = frameOf(nf); let ol = toL(wo, F); const side = ol[2] < 0 ? -1 : 1; ol = mul(ol, side);
    const h = vndf(ol, a, [rnd(), rnd()]); const il = sub(mul(h, 2 * dot(ol, h)), ol);
    if (il[2] <= 0) return { wi: wo, weight: 0, pdf: 0 };
    const wi = fromL(mul(il, side), F);
    if (!mask(wi, nf)) return { wi, weight: 0, pdf: 0 };
    return { wi, weight: G1(il, a), pdf: G1(ol, a) * D(h, a) / (4 * Math.abs(ol[2])) };
}

const out: string[] = [];
// ---------------------------------------------------------------- 1. flip guarantee
{
    let worst = Infinity, fails = 0;
    for (let i = 0; i < 2e6; i++) {
        const wo = upperHemi(); const s = Math.tan(Math.acos(rnd()) * 0.999) ; const ph = 2 * Math.PI * rnd();
        const gS: V3 = [s * Math.cos(ph), s * Math.sin(ph), 0];
        const nf = perturb(NG, gS, rnd() < 0.5 ? 1 : -1, wo); const c = dot(wo, nf);
        if (wo[2] > 0) { worst = Math.min(worst, c / wo[2]); if (c <= 0) fails++; }
    }
    out.push(`1 flip guarantee: 2e6 random (wo, gradient up to slope ~600): wo·n_f<=0 count=${fails}; min (wo·n_f)/(wo·n) = ${worst.toExponential(3)}`);
}
// ---------------------------------------------------------------- 2. lune value, three estimators
{
    const rho = 0.4, s = 1.0; const gS: V3 = [s, 0, 0]; const cosT = 1 / Math.sqrt(1 + s * s);
    const exact = rho * (1 + cosT) / 2;
    const wos: V3[] = [norm([0, 0, 1]), norm([0.95, 0, 0.3]), norm([-0.9, 0.2, 0.4]), norm([0.6, -0.6, 0.2])];
    for (const wo of wos) {
        const nf = perturb(NG, gS, 1, wo); const flipped = dot(wo, norm(sub(NG, gS))) <= 0;
        const N = 4e5; let bs = 0, nee = 0, mis = 0;
        for (let i = 0; i < N; i++) {
            const smp = lambertSample(wo, nf, rho); if (smp.weight > 0 && smp.wi[2] > 0) bs += smp.weight;   // sky L=1 above ng; below ng is plane-occluded (mask kills anyway)
            // NEE: uniform-sphere env sampling, pdf 1/4π
            const wi = uniformSphere(); const pl = 1 / (4 * Math.PI);
            const f = lambertEval(wi, wo, nf, rho); const L = wi[2] > 0 ? 1 : 0;
            if (f > 0) nee += f * Math.abs(dot(wi, nf)) * L / pl;
            // MIS (power heuristic) over the two techniques
            const pb = lambertPdf(wi, wo, nf); if (f > 0) mis += f * Math.abs(dot(wi, nf)) * L / pl * (pl * pl / (pl * pl + pb * pb));
            if (smp.weight > 0 && smp.wi[2] > 0) { const pb2 = smp.pdf; mis += smp.weight * (pb2 * pb2 / (pb2 * pb2 + pl * pl)); }
        }
        out.push(`2 lune wo=${wo.map(x => x.toFixed(2))} flipped=${flipped}: bsdf=${(bs / N).toFixed(4)} nee=${(nee / N).toFixed(4)} mis=${(mis / N).toFixed(4)} exact ρ(1+cosθ)/2=${exact.toFixed(4)}`);
    }
    // what plain pbrt-v4 style (no mask, no flip) would give with sky below the plane too:
    out.push(`2 no-mask reference (sky below too, all light reaches): ρ = ${rho}`);
}
// ---------------------------------------------------------------- 3. albedo ≤ 1 (lambert ρ=1, GGX f0=1)
{
    let maxL = 0, maxG = 0;
    for (let k = 0; k < 300; k++) {
        const wo = upperHemi(); const s = 3 * rnd(); const ph = 2 * Math.PI * rnd(); const gS: V3 = [s * Math.cos(ph), s * Math.sin(ph), 0];
        const nf = perturb(NG, gS, 1, wo); const a = Math.max(1e-3, Math.pow(0.05 + 0.9 * rnd(), 2));
        let aL = 0, aG = 0; const N = 4000;
        for (let i = 0; i < N; i++) { aL += lambertSample(wo, nf, 1).weight; aG += ggxSample(wo, nf, a).weight; }
        maxL = Math.max(maxL, aL / N); maxG = Math.max(maxG, aG / N);
    }
    out.push(`3 albedo: max over 300 random (wo, slope≤3, roughness) configs — lambert ρ=1: ${maxL.toFixed(4)}, ggx f0=1: ${maxG.toFixed(4)} (4000 samples each)`);
}
// ---------------------------------------------------------------- 4. χ² masked sampler vs masked pdf; triple
function chi2Crit(dof: number) { const z = 3.09; return dof * Math.pow(1 - 2 / (9 * dof) + z * Math.sqrt(2 / (9 * dof)), 3); } // Wilson–Hilferty, α≈0.001
for (const model of ['lambert', 'ggx'] as const) {
    for (const cfg of [{ wo: norm([0.3, 0.1, 0.9]) as V3, s: 0.8, r: 0.5 }, { wo: norm([0.9, 0.0, 0.25]) as V3, s: 1.5, r: 0.3 }]) {
        const gS: V3 = [cfg.s, 0.2, 0]; const nf = perturb(NG, gS, 1, cfg.wo); const a = cfg.r * cfg.r;
        const NT = 16, NP = 16; const counts = new Float64Array(NT * NP); let rej = 0; const N = 4e5; let tripleErr = 0, pdfErr = 0;
        const fr = frameOf(nf); const nside = dot(cfg.wo, nf) < 0 ? -1 : 1; void fr; void nside;
        for (let i = 0; i < N; i++) {
            const smp = model === 'lambert' ? lambertSample(cfg.wo, nf, 1) : ggxSample(cfg.wo, nf, a);
            if (smp.pdf <= 0) { rej++; continue; }
            const wi = smp.wi; const ct = wi[2]; const ti = Math.min(NT - 1, Math.floor((1 - ct) / 2 * NT)); const p = (Math.atan2(wi[1], wi[0]) + Math.PI) / (2 * Math.PI); const pi = Math.min(NP - 1, Math.floor(p * NP));
            counts[ti * NP + pi]++;
            const f = model === 'lambert' ? lambertEval(wi, cfg.wo, nf, 1) : ggxEval(wi, cfg.wo, nf, a);
            const q = model === 'lambert' ? lambertPdf(wi, cfg.wo, nf) : ggxPdf(wi, cfg.wo, nf, a);
            tripleErr = Math.max(tripleErr, Math.abs(smp.weight * smp.pdf - f * Math.abs(dot(wi, nf))) / (f * Math.abs(dot(wi, nf))));
            pdfErr = Math.max(pdfErr, Math.abs(smp.pdf - q) / q);
        }
        // expected: integrate the masked pdf over each (cosθ, φ) bin, 24×24 midpoint sub-cells
        let chi2 = 0, cells = 0, expRej = N;
        const SUB = 24;
        for (let ti = 0; ti < NT; ti++) for (let pi = 0; pi < NP; pi++) {
            let m = 0;
            for (let a1 = 0; a1 < SUB; a1++) for (let b1 = 0; b1 < SUB; b1++) {
                const ct = 1 - 2 * (ti + (a1 + 0.5) / SUB) / NT; const ph = 2 * Math.PI * (pi + (b1 + 0.5) / SUB) / NP - Math.PI; const st = Math.sqrt(Math.max(0, 1 - ct * ct));
                const wi: V3 = [st * Math.cos(ph), st * Math.sin(ph), ct];
                m += (model === 'lambert' ? lambertPdf(wi, cfg.wo, nf) : ggxPdf(wi, cfg.wo, nf, a)) * (2 / NT / SUB) * (2 * Math.PI / NP / SUB);
            }
            const e = m * N; expRej -= e;
            if (e > 5) { chi2 += (counts[ti * NP + pi] - e) ** 2 / e; cells++; }
        }
        if (expRej > 5) { chi2 += (rej - expRej) ** 2 / expRej; cells++; }
        out.push(`4 χ² ${model} wo=${cfg.wo.map(x => x.toFixed(2))} slope=${cfg.s}: χ²=${chi2.toFixed(1)} over ${cells} cells (crit ${chi2Crit(cells - 1).toFixed(1)}), rejected ${(rej / N * 100).toFixed(2)}% (expected ${(expRej / N * 100).toFixed(2)}%), max triple rel err ${tripleErr.toExponential(1)}, max pdf rel err ${pdfErr.toExponential(1)}`);
    }
}
// ---------------------------------------------------------------- 5. FD step: central differences in float32
{
    const f32 = Math.fround;
    const amp = 0.02, k = 40; // height field h(p) = amp·sin(k x)·sin(k y)·sin(k z) (feature size ~ 0.08)
    const h = (p: V3) => f32(amp * f32(Math.sin(f32(k * p[0]))) * f32(Math.sin(f32(k * p[1]))) * f32(Math.sin(f32(k * p[2]))));
    const grad = (p: V3): V3 => [amp * k * Math.cos(k * p[0]) * Math.sin(k * p[1]) * Math.sin(k * p[2]), amp * k * Math.sin(k * p[0]) * Math.cos(k * p[1]) * Math.sin(k * p[2]), amp * k * Math.sin(k * p[0]) * Math.sin(k * p[1]) * Math.cos(k * p[2])];
    for (const scale of [1, 10]) for (const eps of [1e-2, 3e-3, 1e-3, 3e-4, 1e-4, 1e-5]) {
        let worst = 0;
        for (let i = 0; i < 20000; i++) {
            const p: V3 = mul([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1], scale).map(f32) as V3; const F = frameOf(upperHemi());
            const at = (d: V3, e: number) => h(add(p, mul(d, e)).map(f32) as V3);
            const ht = (at(F.t, eps) - at(F.t, -eps)) / (2 * eps), hb = (at(F.b, eps) - at(F.b, -eps)) / (2 * eps);
            const g = grad(p); const et = ht - dot(g, F.t), eb = hb - dot(g, F.b);
            worst = Math.max(worst, Math.hypot(et, eb) / (amp * k));
        }
        out.push(`5 FD |p|≤${scale} step=${eps}: worst |∇_S h error| / max|∇h| = ${worst.toExponential(2)}`);
    }
}
console.log(out.join('\n'));
