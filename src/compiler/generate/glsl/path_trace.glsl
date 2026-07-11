// Path trace loop
// Requires: MAX_BOUNCES (define), environment_radiance(), interaction_surface_* dispatch (§3.3),
//           material_is_emissive() (generated emission gate)
// Optional: ENABLE_NEE, ENABLE_RUSSIAN_ROULETTE, RR_START_DEPTH (defines);
//           HAS_MEDIA / HAS_NULL_INTERFACES / HAS_SCATTERING + MAX_NULL_CROSSINGS (media —
//           see fable-volumetric-component.md; media-free scenes preprocess to the same loop)

Radiance transport_trace(Ray ray) {
    Spectrum throughput = SPECTRUM_ONE;
    Radiance radiance   = SPECTRUM_ZERO;
    Ray current_ray = ray;

#ifdef HAS_TRANSMISSION
    // §7.2 etaScale: transmission compresses radiance by η² (restored on exit), so RR keyed on
    // raw throughput over-kills inside dense media — this factor divides the compression back
    // out of the survival metric only. Efficiency, not bias.
    float eta_scale = 1.0;
#endif
#ifdef HAS_MEDIA
    // §4.4: THE medium variable — a single int ground-truthed by classification (self-heal
    // below), never a stack. Camera starts in ambient (-1 → ambientMedium via material_of);
    // a camera inside a BOUNDED medium mistracks exactly one segment, then heals —
    // classification-init is a two-line upgrade when a scene needs it.
    int current_medium = -1;
#endif
#ifdef HAS_NULL_INTERFACES
    int null_crossings = 0;   // §3.6: nulls are bookkeeping with their own safety counter
#endif

    // §6.2 bookkeeping hook: tracked now, consumed when MIS / samplable environment land.
    // The camera "bounce" counts as delta so bounce-0 emission would be full-weight. Inert for
    // Lambert (never delta) until those readers exist — see docs/impl-plan-interaction-reshape.
    bool prev_was_delta = true;

    for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        Hit hit;
#ifdef HAS_MEDIA
        bool boundary = scene_intersect(current_ray, hit);

        // The volumetric component's call site (fable-volumetric-component §2): one segment,
        // ending at the boundary or the far clip — an absorbing ambient extinguishes the
        // environment automatically. medium_sample never sees a boundary; entering/exiting is
        // the interface machinery's job below. The gate constant-folds away for media-less
        // current_medium values.
        int med_mat = material_of(current_medium);
        if (material_has_medium(med_mat)) {
            MediumSample ms = medium_sample(med_mat, current_ray, boundary ? hit.t : MAX_DIST, random2());
            throughput *= ms.weight;
#ifdef HAS_SCATTERING
            if (ms.scattered) {
                // ---- MEDIUM EVENT (§7.2 step 2) ----
                Point p_evt = ambient_geodesic(current_ray.origin, current_ray.direction, ms.t);
                Direction wo_med = -current_ray.direction;
#ifdef ENABLE_NEE
                // NEE from the medium point: phase EVAL, NO cosine (§2.2 — the cosine is a
                // surface Jacobian). Spectral shadow query (shadow_media) walks the segments.
                {
                    MediumProperties m_evt = scene_medium_properties(med_mat, p_evt);
                    LightSample ls = lighting_sample(p_evt, random2());
                    if (ls.pdf > 0.0) {
                        Spectrum vis = shadow_transmittance(make_ray(p_evt, ls.wi), ls.distance);
                        if (!spectrum_is_black(vis)) {
                            radiance += throughput * ls.radiance * hg_eval(ls.wi, wo_med, m_evt) * vis / ls.pdf;
                        }
                    }
                }
#endif
                // Phase sample (§3.5): weight is SPECTRUM_ONE exactly — HG sampling is exact.
                InteractionSample ps = hg_sample(wo_med, scene_medium_properties(med_mat, p_evt), random2());
                throughput *= ps.weight;
                prev_was_delta = false;
                current_ray = make_ray(p_evt, ps.wi);   // continue from the event — no surface offset

#ifdef ENABLE_RUSSIAN_ROULETTE
                // §7.2 pin: RR once per iteration, post-weight — medium events included.
                // (Inline duplicate of the surface RR block until the item-9 generator split.)
#ifdef HAS_TRANSMISSION
                float rr_metric_med = spectrum_max(throughput) * eta_scale;
#else
                float rr_metric_med = spectrum_max(throughput);
#endif
                if (bounce >= RR_START_DEPTH) {
                    float p_survive_med = min(0.95, rr_metric_med);
                    if (random() > p_survive_med) break;
                    throughput /= p_survive_med;
                }
#endif
                continue;   // loop-header bounce++: medium events COUNT toward the budget (§7.2)
            }
#endif
        }
        if (!boundary) {
#else
        if (!scene_intersect(current_ray, hit)) {
#endif
            radiance += throughput * environment_radiance(current_ray.direction);
            break;
        }

#ifdef HAS_MEDIA
        // §4.4 self-heal (free — the operand was already classified): a missed boundary event
        // mistracks exactly one segment and repairs here, instead of corrupting the path.
        if (hit.region_from != current_medium) current_medium = hit.region_from;
#endif

        int mat = material_of(hit.region_owner);        // §4.1: the boundary OWNER's BSDF shades (≠ region_to at exits)
#ifdef HAS_NULL_INTERFACES
        // §3.6 null interface: the boundary is not an optical event — pass through in the same
        // direction; no emission, no NEE, no bounce consumed (pbrt-v3's own bounce-- mechanism;
        // nulls have their own safety counter).
        if (is_null_interface(mat)) {
            current_medium = hit.region_to;
            current_ray = ray_spawn(hit, current_ray.direction);   // far side by sign(dir·n)
            null_crossings++;
            if (null_crossings > MAX_NULL_CROSSINGS) break;
            bounce--;
            continue;
        }
#endif
        MaterialProperties props = scene_material_properties(mat, hit.p);
        Direction wo = -current_ray.direction;

        // Emission keys on region_to (§6.2 side convention: you receive emission from the region
        // ahead) — NOT on the owner. They differ at exits: leaving an emissive region contributes
        // nothing from behind. The generated material_is_emissive gate makes the fetch+dispatch
        // compile-time conditional (reference-loop pattern; review's unguarded-emission fix).
        int mat_emit = material_of(hit.region_to);
        if (material_is_emissive(mat_emit)) {
            // No ternary here: ANGLE rejects '?:' on struct operands (ESSL restriction).
            MaterialProperties eprops = props;
            if (mat_emit != mat) eprops = scene_material_properties(mat_emit, hit.p);
            radiance += throughput * interaction_surface_emission(mat_emit, wo, hit, eprops);
        }

#ifdef ENABLE_NEE
        // Next Event Estimation (explicit xi — §2.9; delta lights ignore it). Pure-delta
        // materials skip it entirely (generated guard): their eval is zero, the shadow march
        // would be wasted.
        if (material_has_nondelta_lobes(mat)) {
            LightSample ls = lighting_sample(hit.p, random2());
            if (ls.pdf > 0.0) {
                // §6.3: the shadow query returns per-channel transmittance (opaque form: 0 or 1).
                // The shadow ray is a pure seed; its far bound (the light distance) is an argument.
                Ray shadow_ray = ray_spawn(hit, ls.wi);
                Spectrum vis = shadow_transmittance(shadow_ray, ls.distance - EPSILON);
                if (!spectrum_is_black(vis)) {
                    Spectrum f = interaction_surface_eval(mat, ls.wi, wo, hit, props);  // bare f (§2.2)
                    float cos_i = abs(ambient_dot(ls.wi, hit.frame.n, hit.p));          // transport applies the cosine (metric)
                    radiance += throughput * ls.radiance * f * cos_i * vis / ls.pdf;
                }
            }
        }
#endif

        // BSDF sampling: sample-returns-weight collapses scatter+shade+pdf into one line (§2.1).
        InteractionSample bs = interaction_surface_sample(mat, wo, hit, props, random(), random2());
        if (spectrum_is_black(bs.weight)) break;
        throughput *= bs.weight;
        prev_was_delta = (bs.flags & LOBE_DELTA) != 0u;

#ifdef HAS_MEDIA
        // §4.4: transmission moves the path into the far region's medium (tinted glass
        // interiors compose: interface `transmittance` here, Beer–Lambert per segment above).
        if ((bs.flags & LOBE_TRANSMISSION) != 0u) current_medium = hit.region_to;
#endif

#ifdef HAS_TRANSMISSION
        // Accumulate the η² compression this crossing added (derivable from the hit's regions —
        // no eta field on the sample struct needed).
        if ((bs.flags & LOBE_TRANSMISSION) != 0u) {
            float r = ior_of(hit.region_to) / ior_of(hit.region_from);
            eta_scale *= r * r;
        }
#endif

#ifdef ENABLE_RUSSIAN_ROULETTE
        // Russian roulette — §7.2 pin: once per iteration, AFTER throughput *= weight, so survival
        // is keyed on post-weight throughput (kills worthless paths before the next trace).
#ifdef HAS_TRANSMISSION
        float rr_metric = spectrum_max(throughput) * eta_scale;   // η²-corrected (§7.2 note)
#else
        float rr_metric = spectrum_max(throughput);   // §2.5: basis-agnostic, no Rec.709 weights
#endif
        if (bounce >= RR_START_DEPTH) {
            float p_survive = min(0.95, rr_metric);
            if (random() > p_survive) break;
            throughput /= p_survive;
        }
#endif

        // Continuation ray: ray_spawn escapes the origin to wi's side of the surface along the
        // geodesic (self-intersection; transmission gets the far side). See docs/trace-loop-contract.md.
        current_ray = ray_spawn(hit, bs.wi);
    }

    return radiance;
}
