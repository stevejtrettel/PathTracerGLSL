// Provides: vec3 integrate(vec2 fragCoord)

// Constant HDR-ish color to prove tone mapping will do something visible.
// (values > 1 will show up when we implement the Display plugin next)
vec3 integrate(vec2 fragCoord) {
    return vec3(1.6, 0.4, 0.9);
}
