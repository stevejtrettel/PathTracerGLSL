// MIS math — transport shared part, included by the integrator iff the estimator is
// 'mis' (conditional INCLUSION, not preprocessor gating — item-9 commit D). Called only
// by combiner-emitted weights; forward-declared via the transport `provides` seam.
// Power heuristic, β = 2 (§6.4) — ONE definition; both MIS sides use it (reference §8).
float power_heuristic(float pf, float pg) {
    float f2 = pf * pf;
    return f2 / max(1e-20, f2 + pg * pg);
}
