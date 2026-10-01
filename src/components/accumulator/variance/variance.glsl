// The variance statistic of the running mean (Welford, normalized form). The picture holds
// v = M2/n, the per-channel population variance of the samples; the variance of the
// accumulated MEAN is ≈ v/n, and readers divide (they know n). With v = M2/n both updates have
// the running-average shape: mean' = mix(mean, x, 1/(n+1)) and
// v' = mix(v, (x − mean)·(x − mean'), 1/(n+1)). The cross product (x − mean)·(x − mean') is the
// cancellation-free form; the naive E[x²] − mean² collapses in fp32 on nearly-converged pixels.
// The first sample (n = 0) has no spread: v = 0.
// Provides: variance_update().

vec3 variance_update(vec3 previous, vec3 mean_previous, vec3 mean_new, vec3 x, int n) {
    if (n == 0) return vec3(0.0);
    float new_weight = 1.0 / (float(n) + 1.0);
    vec3 delta = x - mean_previous;
    vec3 delta_new = x - mean_new;
    return mix(previous, delta * delta_new, new_weight);
}
