// Shadow transmittance — opaque specialization (§6.3).
// Provides: shadow_transmittance(). Depends on: scene_intersect_any() (intersection),
//           Ray/Spectrum (structs), SPECTRUM_ZERO/ONE (math), EPSILON.
//
// The §6.3 contract returns a Spectrum: the per-channel fraction of light surviving the trip
// from `p` toward `wi` over `dist`. This is the OPAQUE specialization the compiler emits when
// the scene has no media — transmittance is exactly 0 (blocked) or 1 (clear), so it is the
// old boolean occlusion test moved behind the spectral contract. When media exist the compiler
// emits the segment-walking form instead (reference-implementations §4); the NEE call site
// never changes. Caller pre-offsets `p` off the surface (hit.p + n·EPSILON).

Spectrum shadow_transmittance(Point p, Direction wi, float dist) {
    Ray shadow_ray;
    shadow_ray.origin    = p;
    shadow_ray.direction = wi;
    shadow_ray.tmin      = EPSILON;
    shadow_ray.tmax      = dist;
    return scene_intersect_any(shadow_ray, dist) ? SPECTRUM_ZERO : SPECTRUM_ONE;
}
