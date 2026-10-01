// The latest sample, with no history — the `oneshot` mode's update rule. The image updates
// live instead of converging; u_sampleCount still advances, so the RNG stream decorrelates and
// the grain animates. (Distinct from the reserved `exponential` mode, a decaying blend.)
// Provides: oneshot_update().

vec3 oneshot_update(vec3 x) {
    return x;
}
