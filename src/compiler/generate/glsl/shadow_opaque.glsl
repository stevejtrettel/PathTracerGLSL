// Shadow transmittance — opaque specialization (§6.3, revised per docs/trace-loop-contract.md).
// Provides: shadow_transmittance(). Depends on: scene_intersect_any() (intersection),
//           Ray/Spectrum (structs), SPECTRUM_ZERO/ONE (math).
//
// The contract returns a Spectrum: the per-channel fraction of light surviving the shadow ray.
// This is the OPAQUE specialization the compiler emits when the scene has no media —
// transmittance is exactly 0 (blocked) or 1 (clear), the boolean occlusion test behind the
// spectral contract. When media exist the compiler emits the segment-walking form instead
// (reference-implementations §4); the NEE call site never changes. The caller passes the shadow
// Ray (origin escaped off the surface) and the far bound (the light distance) as maxDist.

Spectrum shadow_transmittance(Ray shadow_ray, float maxDist) {
    return scene_intersect_any(shadow_ray, maxDist) ? SPECTRUM_ZERO : SPECTRUM_ONE;
}
