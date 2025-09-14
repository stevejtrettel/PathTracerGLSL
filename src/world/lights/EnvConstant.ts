/**
 * Purpose: Constant-environment lighting for bring-up and simple tests.
 * Public contract: vec3 environmentRadiance(vec3 dir); float environmentPdf(vec3 dir) (unused in v1).
 * Inputs: Uniform color/intensity; ray direction from camera/tracer.
 * Outputs: Radiance along direction; uniform pdf stub if queried.
 * Lifecycle: Called when ray misses; always available in v1.
 * Invariants: No two-point solves; no textures unless provided by parameters.
 */
