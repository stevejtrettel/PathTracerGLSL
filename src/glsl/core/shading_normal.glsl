// Shading-normal perturbation (bump mapping): the shading frame a bumped material shades in,
// and the mask that keeps its BSDF on the true surface's sides. Included only in programs with
// a bumped material. The model, its sign conventions and its accepted darkening are in
// components/materials/README.md, "Shading-normal perturbation".
// Provides: bump_surface_gradient(), shading_frame_perturbed(), shading_side_consistent(),
//           shading_masked().
// Depends on: bump_height (generated, the authored height fields), Hit/Frame, InteractionSample,
//             SPECTRUM_ZERO, ambient_geodesic/ambient_dot/ambient_frame.

// ∇_S h at hit.p, the surface gradient of material `mat`'s height field (world units per
// world unit): central differences along the base frame's two tangents, each displacement a
// geodesic of length `step`. Any orthonormal tangent pair gives the same gradient, so the
// arbitrary tangent of the base frame does not matter. Error, relative to max|∇h|, for
// features of size ℓ: truncation ≈ (step/ℓ)²/2, float rounding ≈ 2·|p|·2⁻²⁴/step (the README
// states the law; tests/glsl/shadingNormal.test.ts pins it).
Direction bump_surface_gradient(int mat, Hit hit, float step) {
    Frame f = hit.frame;
    float dt = bump_height(mat, ambient_geodesic(hit.p, f.t, step)) - bump_height(mat, ambient_geodesic(hit.p, f.t, -step));
    float db = bump_height(mat, ambient_geodesic(hit.p, f.b, step)) - bump_height(mat, ambient_geodesic(hit.p, f.b, -step));
    return (dt * f.t + db * f.b) * (0.5 / step);
}

// The perturbed shading frame. The bumped surface p + h·n_out has, to first order in h, the
// outward normal n_out − ∇_S h. hit.frame.n faces region_from, which is n_out exactly when the
// ray entered the owner (region_to == region_owner, σ = +1) and −n_out otherwise; so the
// shading normal is σ·(n_out − ∇_S h) = n − σ·∇_S h, the same surface seen from either side.
// Flip (Schüssler et al. 2017, as Mitsuba 3's PerturbedBSDF does it): if wo lies below the
// perturbed normal, mirror it across the base normal, n'' = 2(n'·n)n − n'. With wo·n > 0 and
// n'·n > 0 this gives wo·n'' > 0, so every model sees wo above its shading normal.
Frame shading_frame_perturbed(Hit hit, Direction wo, Direction grad) {
    Direction n = hit.frame.n;
    float sigma = hit.region_to == hit.region_owner ? 1.0 : -1.0;
    Direction np = n - sigma * grad;
    if (ambient_dot(wo, np, hit.p) <= 0.0) np = 2.0 * ambient_dot(np, n, hit.p) * n - np;
    return ambient_frame(hit.p, np);   // normalizes in the metric seam
}

// The mask: a direction wi is kept only if it lies on the same side of the TRUE surface (hit.ng)
// as of the shading normal (hit.frame.n, the perturbed frame after the walk's swap). The same
// predicate gates eval, pdf and sample, so the masked BSDF and its sampler stay one density.
// ng, not the base shading normal: ray_spawn picks the side from ng and the walk updates the
// medium from the lobe flags, so a "reflection" below ng would cross the surface unrecorded.
bool shading_side_consistent(Hit hit, Direction wi) {
    return ambient_dot(wi, hit.ng, hit.p) * ambient_dot(wi, hit.frame.n, hit.p) > 0.0;
}

// The sample-side form of the mask: a rejected direction is killed (weight and pdf 0), not
// redrawn, so the density of the surviving directions is the model's own pdf there.
InteractionSample shading_masked(InteractionSample s, Hit hit) {
    if (!shading_side_consistent(hit, s.wi)) {
        s.weight = SPECTRUM_ZERO;
        s.pdf = 0.0;
    }
    return s;
}
