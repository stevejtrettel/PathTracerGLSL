// T2 variant — EQUIANGULAR medium NEE, per-segment site (Kulla–Fajardo 2012;
// impl-plan-equiangular). Places the direct-lighting vertex along the segment by the
// angle subtended at the light: pdf(t) ∝ 1/d²(t)-to-light, cancelling the integrand's
// peak that transmittance placement is blind to. Runs ONCE per medium segment with
// segment-start throughput, independent of whether the transmittance sample scatters —
// that independence is the technique's point. Replaces light_medium.glsl's at-vertex
// site under estimator.mediumLightSampling 'equiangular'.
// V1 pins (Validator-enforced): delta lights only; nee only (weight 1 — no combiner
// call until placement-MIS is designed); homogeneous T(0,t) (analytic, matching the
// volumeSampling='analytic' axis). EUCLIDEAN math (t_c, h are extrinsic distances —
// like the analytic medium bodies; curved-space equiangular is a research item).
// Provides: equiangular_sample_direct().
// Depends on: PathState core, lighting_query_delta (generated), shadow_transmittance,
//             shadow_crossings_left (generated),
//             scene_medium_properties, interaction_medium_eval (generated dispatch),
//             spectrum_exp, ambient_geodesic, make_ray.

void equiangular_sample_direct(inout PathState s, int med_mat, float t_max) {
    Point o = s.ray.origin;
    Direction d = s.ray.direction;
    Point pos; Spectrum intensity;
    float select_pdf = lighting_query_delta(random(), pos, intensity);

    // The light's frame over the segment: closest approach t_c, perpendicular h.
    vec3 D = pos - o;
    float t_c = dot(D, d);
    float h2 = max(dot(D, D) - t_c * t_c, 1e-8);   // clamp: light on the ray line
    float h = sqrt(h2);

    // Uniform in subtended angle: t = t_c + h·tan(θ); atan2 form is stable at |t−t_c| ≫ h.
    float theta_a = atan(0.0 - t_c, h);
    float theta_b = atan(t_max - t_c, h);
    float theta = mix(theta_a, theta_b, random());
    float t = t_c + h * tan(theta);
    float pdf_t = h / ((theta_b - theta_a) * (h2 + (t - t_c) * (t - t_c)));

    Point p_evt = ambient_geodesic(o, d, t);
    MediumProperties m_evt = scene_medium_properties(med_mat, p_evt);

    // Segment transmittance to the sampled vertex — analytic, homogeneous (§4; the v1
    // homogeneous pin — the analytic arm's closed form, restated at this second site).
    Spectrum T_seg = spectrum_exp(-(m_evt.sigma_a + m_evt.sigma_s) * t);

    vec3 to_light = pos - p_evt;
    float d2 = max(dot(to_light, to_light), 1e-8);
    float dist = sqrt(d2);
    Direction wi = to_light / dist;
    // pos = the light POINT (drift-free target); the path's remaining null-crossing budget.
    Spectrum vis = shadow_transmittance(make_ray(p_evt, wi), pos, shadow_crossings_left(s));
    if (spectrum_is_black(vis)) return;

    // Delta convention (§6.1): 1/d² folds into the incident radiance here. Phase EVAL,
    // NO cosine (§2.2). σ_s is explicit — this estimate rides no medium_sample weight.
    Direction wo_med = -d;
    s.radiance += s.throughput * T_seg * m_evt.sigma_s * interaction_medium_eval(wi, wo_med, m_evt)
        * (intensity / d2) * vis / (pdf_t * select_pdf);
}
