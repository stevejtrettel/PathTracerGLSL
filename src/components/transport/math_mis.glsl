// MIS math — transport shared part, included by the integrator iff the estimator is
// 'mis' (conditional INCLUSION, not preprocessor gating — item-9 commit D). Called only
// by combiner-emitted weights; forward-declared via the transport `provides` seam.
// Power heuristic, β = 2 (§6.4) — ONE definition; both MIS sides use it (reference §8).
float power_heuristic(float pf, float pg) {
    float f2 = pf * pf;
    // A near-singular pdf (e.g. a very narrow lobe) can overflow its square to +inf, and
    // inf/inf is NaN — one NaN sample poisons the pixel's running mean forever. Its weight
    // is 1 in the limit (pbrt-v4's PowerHeuristic has the same guard). A threshold compare
    // rather than isinf(): some WebGL drivers compile isinf() under no-inf assumptions.
    if (f2 >= 1.0e38) return 1.0;
    return f2 / max(1e-20, f2 + pg * pg);
}
