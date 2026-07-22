// T1 — KERNEL SAMPLING (fable-components §7; emitted shape per fable-transport-glsl-target §3).
// One draw serves two estimator terms: the recursion's next segment AND a direct-
// lighting sample scored where it LANDS (the deferred sites below), with the record
// kernel_record carried forward. Weights are the combiner's; this file is the math.
// Provides: kernel_score_miss(), kernel_score_emitter_hit(), kernel_sample_continuation().
// Depends on: PathState core (ray/throughput/radiance ONLY — the static-file rule),
//             combiner_w_env/combiner_w_emitter, kernel_record (generated),
//             interaction_surface_sample/_emission, material_is_emissive,
//             environment_radiance, scene_material_properties, material_of.

void kernel_score_miss(inout PathState s) {
    // Deferred scoring, boundary case: the sample escaped to the environment.
    s.radiance += s.throughput * combiner_w_env(s) * environment_radiance(s.ray.direction);
}

void kernel_score_emitter_hit(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props) {
    // Deferred scoring: emission keys on region_to (§6.2 — you receive emission from
    // the region ahead, NOT the owner; they differ at exits).
    int mat_emit = material_of(hit.region_to);
    if (!material_is_emissive(mat_emit)) return;
    // No ternary: ANGLE rejects '?:' on struct operands (ESSL restriction).
    MaterialProperties eprops = props;
    if (mat_emit != mat) eprops = scene_material_properties(mat_emit, hit.p, hit.uv, hit.element);
    s.radiance += s.throughput * combiner_w_emitter(s, hit) * interaction_surface_emission(mat_emit, wo, hit, eprops);
}

bool kernel_sample_continuation(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props, out InteractionSample bs) {
    // Sample-returns-weight collapses scatter+shade+pdf into one line (§2.1).
    bs = interaction_surface_sample(mat, wo, hit, props, random(), random2());
    if (spectrum_is_black(bs.weight)) return false;
    s.throughput *= bs.weight;
    kernel_record(s, bs.pdf, hit.p, (bs.flags & LOBE_DELTA) != 0u);
    return true;
}
