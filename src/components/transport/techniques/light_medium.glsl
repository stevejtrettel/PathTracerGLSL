// T2's medium site (included when NEE ∧ scattering media).
// Provides: light_sample_direct_medium().
// Depends on: PathState core, combiner_w_light_medium (generated), lighting_sample,
//             shadow_transmittance, scene_medium_properties, hg_eval, make_ray.

void light_sample_direct_medium(inout PathState s, int med_mat, Point p_evt, Direction wo_med) {
    // Phase EVAL, NO cosine (§2.2 — the cosine is a surface Jacobian).
    MediumProperties m_evt = scene_medium_properties(med_mat, p_evt);
    LightSample ls = lighting_sample(p_evt, random2());
    if (ls.pdf <= 0.0) return;
    Spectrum vis = shadow_transmittance(make_ray(p_evt, ls.wi), ls.distance - 2.0 * EPSILON);
    if (spectrum_is_black(vis)) return;
    s.radiance += s.throughput * ls.radiance * hg_eval(ls.wi, wo_med, m_evt) * vis * combiner_w_light_medium(ls, wo_med, m_evt) / ls.pdf;
}
