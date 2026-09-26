// T2 — LIGHT SAMPLING / NEE, surface site (included when NEE is on).
// Both edge endpoints known immediately: sample, shadow-test, score — all local.
// Provides: light_sample_direct().
// Depends on: PathState core, combiner_w_light (generated), lighting_sample,
//             shadow_transmittance, shadow_crossings_left (generated), material_has_nondelta_lobes,
//             interaction_surface_eval, ray_spawn, ambient_direction_to, ambient_dot.

void light_sample_direct(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props) {
    // Pure-delta materials skip NEE: their eval is zero, the march would be wasted.
    if (!material_has_nondelta_lobes(mat)) return;
    LightSample ls = lighting_sample(light_query_surface(mat, hit), random2());
    if (ls.pdf <= 0.0) return;
    // The shadow ray tests the segment from the surface to the sampled LIGHT POINT. Its origin is
    // moved hit.eps off the surface (ray_spawn), so its direction is re-aimed from there at the
    // light point: kept parallel to ls.wi it would pass beside the point, hit.eps away, and at a
    // slant it would meet the light's own surface before the back-off. Only visibility uses the
    // aimed direction; f, the cosine and the pdfs below keep ls.wi from hit.p. vis is the
    // per-channel transmittance (§6.3); the walker takes the light point, which fixes its far
    // bound, and the null crossings this path may still make (measurement.maxNullCrossings).
    Point light_p = ambient_geodesic(hit.p, ls.wi, ls.distance);
    Ray shadow_ray = ray_spawn(hit, ls.wi);
    shadow_ray.direction = ambient_direction_to(shadow_ray.origin, light_p);
    Spectrum vis = shadow_transmittance(shadow_ray, light_p, shadow_crossings_left(s));
    if (spectrum_is_black(vis)) return;
    Spectrum f = interaction_surface_eval(mat, ls.wi, wo, hit, props);   // bare f (§2.2)
    float cos_i = abs(ambient_dot(ls.wi, hit.frame.n, hit.p));           // transport applies the cosine (metric)
    s.radiance += s.throughput * ls.radiance * f * cos_i * vis * combiner_w_light(mat, ls, wo, hit, props) / ls.pdf;
}
