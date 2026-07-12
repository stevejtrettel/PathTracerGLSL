// MIS math — included by core iff the estimator is 'mis' (commit D of the item-9 split:
// conditional INCLUSION replaced the ENABLE_MIS preprocessor gate).
// Power heuristic, β = 2 (§6.4) — ONE definition; both MIS sides use it (reference §8).
float power_heuristic(float pf, float pg) {
    float f2 = pf * pf;
    return f2 / max(1e-20, f2 + pg * pg);
}
