// tests/helpers/halfspace.ts — the SEMI-INFINITE SCATTERING HALFSPACE, solved on the CPU.
//
// WHY THIS FILE EXISTS. `docs/fable-subsurface.md` §8 Step 3 asks for a test that a medium
// authored for a colour actually renders as that colour. The first attempt at it compared a
// camera's reading against the authored colour directly, and failed by 5-15% — not because
// anything was broken, but because those are two DIFFERENT QUANTITIES:
//
//   the authored colour C   is the SPHERICAL albedo — total reflected flux / incident flux for
//                           a medium lit uniformly from the whole hemisphere. One number.
//   a camera reads          the PLANE albedo A_p(µ) — reflectance for ONE exit direction.
//                           A whole curve in µ = cos(exit angle).
//
// They coincide only for a Lambertian reflector, and a scattering halfspace is not one: its
// return is brighter at grazing than at normal, and most so at low albedo where single
// scattering dominates. van de Hulst's fit — the relation `subsurfaceMedium` inverts — is a fit
// to the SPHERICAL albedo. So the authored colour was never the right expectation for a camera,
// and a witness built on it was gating an identity that is false.
//
// This file supplies both quantities, so each claim can be gated against the right one:
//
//   planeAlbedo(ω, µ)   → what a camera measures. The GPU witness's expected value.
//   sphericalAlbedo(ω)  → what the inversion promises. The CPU unit test's expected value.
//
// TWO TIERS, AND THEY ARE NOT THE SAME KIND OF STATEMENT (witnesses/README.md, `source.tier`):
//
//   EXACT — for ISOTROPIC scattering there is a classical closed-form solution of the radiative
//     transfer equation, due to Chandrasekhar: every albedo of a semi-infinite isotropically
//     scattering halfspace is expressible through one function H(µ), and
//
//         A_p(µ) = 1 − √(1−ω)·H(µ)                            [plane albedo]
//         A_s    = 1 − 2√(1−ω)·∫₀¹ H(µ)µ dµ                   [spherical albedo]
//
//     H is defined implicitly and is evaluated here by fixed-point iteration to ~1e-14. That is
//     exact mathematics that happens to need a computer — the same kind of number as √2, not an
//     approximation. A witness that misses it has a bug in the renderer.
//
//   CROSS-CHECK — for ANISOTROPIC scattering (our Henyey–Greenstein g ≠ 0) no such solution
//     exists. The only reference available is to simulate the same physics a second time, which
//     `mcHalfspaceAlbedo` does: an independent random walk sharing no code with the GLSL. It has
//     its own statistical error, reported alongside the value, and a disagreement implicates BOTH
//     implementations rather than convicting the renderer.
//
// The MC is DETERMINISTIC (fixed seed, no Math.random) so a failing test is reproducible and a
// green one cannot flicker.

/** A quadrature rule on [0, 1]: `x` nodes, `w` weights. */
interface Quadrature { x: number[]; w: number[] }

/**
 * Gauss–Legendre nodes and weights on [0, 1], by Newton iteration on the Legendre polynomial.
 * 64 nodes integrates the smooth H-kernel far past the precision the iteration converges to.
 */
function gaussLegendre(n: number): Quadrature {
    const x: number[] = [];
    const w: number[] = [];
    for (let i = 0; i < n; i++) {
        // Chebyshev starting guess for the i-th root of P_n on [-1, 1].
        let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
        let dp = 0;
        for (let it = 0; it < 100; it++) {
            // Legendre recurrence: p0 = P_n(z), p1 = P_{n-1}(z).
            let p0 = 1;
            let p1 = 0;
            for (let j = 0; j < n; j++) {
                const p2 = p1;
                p1 = p0;
                p0 = ((2 * j + 1) * z * p1 - j * p2) / (j + 1);
            }
            dp = (n * (z * p0 - p1)) / (z * z - 1);
            const dz = -p0 / dp;
            z += dz;
            if (Math.abs(dz) < 1e-15) break;
        }
        x.push(0.5 * (1 - z));                     // map [-1,1] → [0,1]
        w.push(1 / ((1 - z * z) * dp * dp));       // the [0,1] weight (the ½ is folded in)
    }
    return { x, w };
}

const QUAD = gaussLegendre(64);

/** A solved halfspace: the H function on demand, plus the moment the spherical albedo needs. */
export interface IsotropicHalfspace {
    /** Single-scattering albedo ω = σ_s/σ_t this was solved for. */
    omega: number;
    /** Chandrasekhar's H at any µ ∈ [0, 1]. H(0) = 1; H is increasing in µ. */
    H(mu: number): number;
    /** The first moment ∫₀¹ H(µ)µ dµ — all the spherical albedo needs. */
    moment1: number;
}

/**
 * Solve Chandrasekhar's H-function for isotropic scattering with single-scattering albedo ω.
 *
 * H satisfies the nonlinear integral equation
 *
 *     H(µ) = 1 + (ω/2)·µ·H(µ)·∫₀¹ H(µ′)/(µ + µ′) dµ′
 *
 * which rearranges to the contraction actually iterated here,
 *
 *     H(µ) = 1 / (1 − (ω/2)·µ·∫₀¹ H(µ′)/(µ + µ′) dµ′)
 *
 * evaluated on the quadrature nodes and converged to fixed point.
 *
 * CONVERGENCE, measured rather than assumed: iterations to 1e-14 scale as ~1/√(1−ω) — 394 at
 * ω = 0.999, 1141 at ω = 0.9999. The cap covers past MAX_SINGLE_SCATTER_ALBEDO (0.999999, ~1e4
 * iterations), which is the highest ω anything in this project can author.
 *
 * ω = 1 EXACTLY IS SINGULAR and is not solved here: convergence degrades from geometric to
 * algebraic (200k iterations still leave ~1e-5), which is a property of the conservative
 * transport problem, not of this code. Nothing needs it — see planeAlbedo/sphericalAlbedo, where
 * the √(1−ω) prefactor makes the whole H term vanish at that endpoint.
 */
export function isotropicHalfspace(omega: number): IsotropicHalfspace {
    if (!(omega >= 0 && omega < 1)) {
        throw new Error(
            `isotropicHalfspace: ω = ${omega} must lie in [0, 1). ω = 1 exactly is the singular `
            + `conservative case — the fixed point converges only algebraically there. It is also `
            + `never needed: both albedos carry a √(1−ω) factor that annihilates H at that `
            + `endpoint, so planeAlbedo/sphericalAlbedo answer 1 without solving.`);
    }
    const hit = SOLVED.get(omega);
    if (hit) return hit;

    const { x, w } = QUAD;
    let H = x.map(() => 1);

    // The kernel integral ∫ H(µ′)/(µ + µ′) dµ′ at an arbitrary µ, against the current H samples.
    const kernel = (mu: number, samples: number[]) => {
        let s = 0;
        for (let j = 0; j < x.length; j++) s += w[j] * samples[j] / (mu + x[j]);
        return s;
    };

    let converged = false;
    for (let it = 0; it < 20_000; it++) {
        const next = x.map((mu) => 1 / (1 - 0.5 * omega * mu * kernel(mu, H)));
        let delta = 0;
        for (let i = 0; i < H.length; i++) delta = Math.max(delta, Math.abs(next[i] - H[i]));
        H = next;
        if (delta < 1e-14) { converged = true; break; }
    }
    if (!converged) throw new Error(`isotropicHalfspace: H did not converge at ω = ${omega}`);

    const solved = H;
    let moment1 = 0;
    for (let j = 0; j < x.length; j++) moment1 += w[j] * solved[j] * x[j];

    const result: IsotropicHalfspace = {
        omega,
        // Off-node µ is evaluated from the same equation against the converged samples — not
        // interpolated, so H(1) (the value every normal-incidence witness wants) is as accurate
        // as the nodes themselves.
        H: (mu: number) => 1 / (1 - 0.5 * omega * mu * kernel(mu, solved)),
        moment1,
    };
    SOLVED.set(omega, result);
    return result;
}

/** Solving is a fixed point iteration; test grids ask for the same ω repeatedly. */
const SOLVED = new Map<number, IsotropicHalfspace>();

/**
 * PLANE ALBEDO — the exact reflectance of an isotropically scattering semi-infinite halfspace for
 * a single direction, `A_p(µ) = 1 − √(1−ω)·H(µ)`.
 *
 * THIS IS WHAT A CAMERA MEASURES. Under a uniform environment of radiance L, the radiance leaving
 * in direction µ is L·ρ(µ), where ρ(µ) is the directional-hemispherical reflectance — and by
 * reciprocity that equals the plane albedo for incidence µ. So an orthographic camera pointed at
 * the surface along µ, under a radiance-1 environment, must read exactly this number.
 *
 * Sanity: A_p(1) → 0.1534·ω as ω → 0 (the single-scattering limit) and → 1 as ω → 1.
 */
export function planeAlbedo(omega: number, mu: number): number {
    if (!(mu >= 0 && mu <= 1)) throw new Error(`planeAlbedo: µ = ${mu} must lie in [0, 1]`);
    // The conservative endpoint is exact by degeneracy, not by convention: √(1−ω) = 0 and H is
    // finite, so the product is zero for every µ. A medium that never absorbs returns everything.
    if (omega === 1) return 1;
    return 1 - Math.sqrt(1 - omega) * isotropicHalfspace(omega).H(mu);
}

/**
 * SPHERICAL ALBEDO — the exact hemispherically-integrated reflectance under diffuse illumination,
 * `A_s = 1 − 2√(1−ω)·∫₀¹ H(µ)µ dµ`.
 *
 * THIS IS WHAT THE INVERSION PROMISES. van de Hulst's `C = (1−s)(1−0.139s)/(1+1.17s)` is a fit to
 * this quantity, so `sphericalAlbedo(alphaFromColor(C))` returning C is the honest statement of
 * "the authored colour means what it says" — and it is CPU arithmetic, needing no GPU at all.
 *
 * Sanity: A_s → 0.2046·ω as ω → 0, and 1 at ω = 1.
 */
export function sphericalAlbedo(omega: number): number {
    if (omega === 1) return 1;                   // same degeneracy as planeAlbedo
    const hs = isotropicHalfspace(omega);
    return 1 - 2 * Math.sqrt(1 - omega) * hs.moment1;
}

// ── The stochastic tier ───────────────────────────────────────────────────────────────────────

/** A cross-check value and the uncertainty that comes with it — never one without the other. */
export interface MonteCarloAlbedo {
    /** The estimate. */
    value: number;
    /** One standard error. The estimator is Bernoulli (a walk escapes or it doesn't). */
    stderr: number;
    samples: number;
    /**
     * Walks that hit MAX_WALK_STEPS and were scored as non-escaping — a declared truncation, and
     * the only way this estimator can be biased. It must be ZERO for any α we author: the step
     * count is geometric with mean 1/(1−α), so even α = 0.999 leaves P(>100k steps) ≈ e^-100.
     * Tests assert it rather than trusting it.
     */
    truncated: number;
}

/** The walk-length backstop. At α = 1 the walk escapes with probability 1 but its mean length
 *  diverges, so an unbounded loop is not something a test suite may contain. */
const MAX_WALK_STEPS = 100_000;

/** Deterministic LCG — a fixed stream, so a failing cross-check is reproducible. */
function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return (s >>> 8) / 16777216;
    };
}

/** Sample a Henyey–Greenstein deflection about `w`. Forward convention, matching hg.glsl. */
function sampleHG(w: readonly number[], g: number, rnd: () => number): number[] {
    let cos: number;
    if (Math.abs(g) < 1e-3) {
        cos = 1 - 2 * rnd();
    } else {
        const t = (1 - g * g) / (1 + g - 2 * g * rnd());
        cos = (1 + g * g - t * t) / (2 * g);
    }
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    const phi = 2 * Math.PI * rnd();

    // An orthonormal frame about w (the branch keeps the cross product well-conditioned).
    const a = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u = [w[1] * a[2] - w[2] * a[1], w[2] * a[0] - w[0] * a[2], w[0] * a[1] - w[1] * a[0]];
    const ul = Math.hypot(u[0], u[1], u[2]);
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];

    return [0, 1, 2].map((k) => cos * w[k] + sin * (Math.cos(phi) * u[k] + Math.sin(phi) * v[k]));
}

export interface MonteCarloSpec {
    /** Single-scattering albedo α = σ_s/σ_t. */
    alpha: number;
    /** Phase anisotropy g. 0 reproduces the isotropic closed form — which is how it is gated. */
    g?: number;
    /**
     * Exit direction cosine to measure, or `'diffuse'` for the hemispherically-integrated
     * spherical albedo (entry cosine-distributed, which is the diffuse-illumination condition).
     */
    mu: number | 'diffuse';
    samples?: number;
    seed?: number;
}

/**
 * MONTE-CARLO HALFSPACE ALBEDO — an independent implementation of the same transport, for the
 * anisotropic case where no closed form exists.
 *
 * The walk: enter the halfspace (z < 0) at the surface travelling with cosine µ, step an
 * exponential free path (σ_t = 1, so lengths are in mean free paths), terminate on absorption with
 * probability 1 − α, otherwise deflect by the phase function. Score 1 if the walk crosses back out
 * through z = 0. By reciprocity that escape probability IS the plane albedo at µ; with a
 * cosine-distributed entry it is the spherical albedo.
 *
 * No throughput weighting anywhere — absorption is a genuine coin flip — so this shares no
 * estimator machinery with the renderer, which is exactly what makes it worth comparing against.
 */
export function mcHalfspaceAlbedo(spec: MonteCarloSpec): MonteCarloAlbedo {
    const { alpha, g = 0, mu, samples = 400_000, seed = 0x5eed_1234 } = spec;
    const rnd = lcg(seed);

    let escaped = 0;
    let truncated = 0;
    for (let n = 0; n < samples; n++) {
        // Entry direction: fixed µ, or cosine-distributed for the diffuse-illumination case.
        const m = mu === 'diffuse' ? Math.sqrt(rnd()) : mu;
        let d = [Math.sqrt(Math.max(0, 1 - m * m)), 0, -m];
        let z = 0;

        let step = 0;
        for (; step < MAX_WALK_STEPS; step++) {
            z += d[2] * -Math.log(1 - rnd());
            if (z > 0) { escaped++; break; }        // back out through the surface
            if (rnd() > alpha) break;               // absorbed
            d = sampleHG(d, g, rnd);
        }
        if (step === MAX_WALK_STEPS) truncated++;
    }

    const p = escaped / samples;
    return { value: p, stderr: Math.sqrt(Math.max(p * (1 - p), 0) / samples), samples, truncated };
}
