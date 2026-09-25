// Shadow transmittance — opaque specialization (§6.3, revised per docs/trace-loop-contract.md).
// Provides: shadow_transmittance(). Depends on: scene_intersect_any() (intersection),
//           Ray/Spectrum (structs), SPECTRUM_ZERO/ONE (math).
//
// The contract returns a Spectrum: the per-channel fraction of light surviving the shadow ray.
// This is the OPAQUE specialization the compiler emits when the scene has no media —
// transmittance is exactly 0 (blocked) or 1 (clear), the boolean occlusion test behind the
// spectral contract. When media exist the compiler emits the segment-walking form instead
// (reference-implementations §4); the NEE call site never changes. The caller passes the shadow
// Ray (origin escaped off the surface) and the LIGHT POINT (the destination); the far bound is
// its distance minus SHADOW_BACKOFF (core math — angle-amplified requirement, see its comment)
// so the light's own surface is not seen as an occluder. `crossings_left` (the path's remaining
// null-crossing budget) is unused: without media there are no null interfaces to cross.

Spectrum shadow_transmittance(Ray shadow_ray, Point light_p, int crossings_left) {
    float maxDist = length(light_p - shadow_ray.origin) - SHADOW_BACKOFF;
    return scene_intersect_any(shadow_ray, maxDist) ? SPECTRUM_ZERO : SPECTRUM_ONE;
}
