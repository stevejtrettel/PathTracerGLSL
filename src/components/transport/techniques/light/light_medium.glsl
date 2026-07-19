// T2's medium site (included when NEE ∧ scattering media).
// Provides: light_sample_direct_medium().
// Depends on: PathState core, combiner_w_light_medium (generated), lighting_sample,
//             shadow_transmittance, scene_medium_properties, make_ray,
//             interaction_medium_eval (generated dispatch over the registered phase models).

void light_sample_direct_medium(inout PathState s, int med_mat, Point p_evt, Direction wo_med) {
    // Phase EVAL, NO cosine (§2.2 — the cosine is a surface Jacobian).
    MediumProperties m_evt = scene_medium_properties(med_mat, p_evt);
    LightSample ls = lighting_sample(p_evt, random2());
    if (ls.pdf <= 0.0) return;
    // Pass the LIGHT POINT (drift-free target); the walker measures its back-off against it.
    Point light_p = ambient_geodesic(p_evt, ls.wi, ls.distance);
    Spectrum vis = shadow_transmittance(make_ray(p_evt, ls.wi), light_p);
    if (spectrum_is_black(vis)) return;
    s.radiance += s.throughput * ls.radiance * interaction_medium_eval(ls.wi, wo_med, m_evt) * vis * combiner_w_light_medium(ls, wo_med, m_evt) / ls.pdf;
}
