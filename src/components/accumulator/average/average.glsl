// The running mean — the `average` mode's update rule. After n samples have been folded in,
// the next sample x enters with weight 1/(n+1); the first (n = 0) is written as is, so the
// just-cleared `previous` is never used.
// Provides: average_update().

vec3 average_update(vec3 previous, vec3 x, int n) {
    if (n == 0) return x;
    float new_weight = 1.0 / (float(n) + 1.0);
    return mix(previous, x, new_weight);
}
