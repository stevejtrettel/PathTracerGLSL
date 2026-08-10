// T2 — LIGHT SAMPLING / NEE, surface site (included when NEE is on).
// Both edge endpoints known immediately: sample, shadow-test, score — all local.
// Provides: light_sample_direct().
// Depends on: PathState core, combiner_w_light (generated), lighting_sample,
//             shadow_transmittance, material_has_nondelta_lobes,
//             interaction_surface_eval, ray_spawn, ambient_dot.

void light_sample_direct(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props) {
    // Pure-delta materials skip NEE: their eval is zero, the march would be wasted.
    if (!material_has_nondelta_lobes(mat)) return;
    LightSample ls = lighting_sample(light_query_surface(mat, hit), random2());
    if (ls.pdf <= 0.0) return;
    // §6.3 per-channel transmittance. Pass the LIGHT POINT (not a distance) so the walker's
    // back-off is measured against the fixed target — drift-free across null-interface crossings.
    Ray shadow_ray = ray_spawn(hit, ls.wi);
    Point light_p = ambient_geodesic(hit.p, ls.wi, ls.distance);
    Spectrum vis = shadow_transmittance(shadow_ray, light_p);
    if (spectrum_is_black(vis)) return;
    Spectrum f = interaction_surface_eval(mat, ls.wi, wo, hit, props);   // bare f (§2.2)
    float cos_i = abs(ambient_dot(ls.wi, hit.frame.n, hit.p));           // transport applies the cosine (metric)
    s.radiance += s.throughput * ls.radiance * f * cos_i * vis * combiner_w_light(mat, ls, wo, hit, props) / ls.pdf;
}
